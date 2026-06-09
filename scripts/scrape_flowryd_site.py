#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from lxml import html


DEFAULT_URL = "https://flowryd.paralect.com/"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "data" / "flowryd_site"


@dataclass
class InventoryRow:
    source: str
    provenance: str
    title: str
    make_model: str | None
    condition: str | None
    price_eur: int | None
    price_label: str
    year: int | None
    mileage_km: int | None
    range_km: int | None
    battery_kwh: float | None
    efficiency_kwh_per_100_km: float | None
    body_type: str | None
    location: str | None
    listing_url: str | None
    image_url: str | None


@dataclass
class RagRow:
    source: str
    heading: str
    text_excerpt: str


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape the public FlowRyd static inventory dashboard."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    fetched_at = datetime.now(timezone.utc).isoformat()
    document = html.fromstring(fetch_html(args.url))
    inventory = scrape_inventory(document)
    rag_rows = scrape_rag(document)
    stats = scrape_stats(document)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.out_dir / "inventory.json", [asdict(row) for row in inventory])
    write_json(args.out_dir / "rag.json", [asdict(row) for row in rag_rows])
    write_inventory_csv(args.out_dir / "inventory.csv", inventory)
    write_rag_csv(args.out_dir / "rag.csv", rag_rows)
    write_json(
        args.out_dir / "summary.json",
        {
            "url": args.url,
            "fetched_at": fetched_at,
            "stats": stats,
            "inventory_rows": len(inventory),
            "rag_rows": len(rag_rows),
            "inventory_sources": sorted({row.source for row in inventory}),
            "rag_sources": sorted({row.source for row in rag_rows}),
        },
    )

    print(
        f"Scraped {len(inventory)} inventory rows and {len(rag_rows)} RAG rows "
        f"from {args.url}"
    )
    print(f"Wrote outputs to {args.out_dir}")


def fetch_html(url: str) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": "FlowRydAlphaScraper/0.1 (+https://flowryd.paralect.com/)"
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read()


def scrape_inventory(document: html.HtmlElement) -> list[InventoryRow]:
    rows: list[InventoryRow] = []
    for section in document.xpath("//section[@data-kind='inventory']"):
        source = clean_source(section)
        for card in section.xpath(".//article[contains(concat(' ', normalize-space(@class), ' '), ' veh ')]"):
            title_link = first(card.xpath(".//h3/a"))
            title = clean_text(title_link.text_content() if title_link is not None else "")
            sub = clean_text(first_text(card.xpath(".//div[contains(@class,'sub')]")))
            specs = parse_specs(card)
            foot_text = clean_text(first_text(card.xpath(".//div[contains(@class,'foot')]/span[1]")))
            price_label = clean_text(first_text(card.xpath(".//div[contains(@class,'price')]")))
            image = first(card.xpath(".//div[contains(@class,'thumb')]/img"))

            rows.append(
                InventoryRow(
                    source=source,
                    provenance=clean_text(card.get("data-prov") or ""),
                    title=title,
                    make_model=parse_make_model(sub),
                    condition=parse_condition(sub),
                    price_eur=parse_eur(price_label),
                    price_label=price_label,
                    year=parse_int(specs.get("Year")),
                    mileage_km=parse_int(specs.get("Mileage")),
                    range_km=parse_int(specs.get("Range")),
                    battery_kwh=parse_float(specs.get("Battery")),
                    efficiency_kwh_per_100_km=parse_float(specs.get("Efficiency")),
                    body_type=none_if_empty(specs.get("Body")),
                    location=none_if_empty(foot_text),
                    listing_url=title_link.get("href") if title_link is not None else None,
                    image_url=image.get("src") if image is not None else None,
                )
            )
    return rows


def scrape_rag(document: html.HtmlElement) -> list[RagRow]:
    rows: list[RagRow] = []
    for section in document.xpath("//section[@data-kind='rag']"):
        source = clean_source(section)
        for tr in section.xpath(".//tbody/tr"):
            cells = tr.xpath("./td")
            if len(cells) < 2:
                continue
            rows.append(
                RagRow(
                    source=source,
                    heading=clean_text(cells[0].text_content()),
                    text_excerpt=clean_text(cells[1].text_content()),
                )
            )
    return rows


def scrape_stats(document: html.HtmlElement) -> dict[str, str]:
    stats: dict[str, str] = {}
    for stat in document.xpath("//div[contains(@class,'stat')]"):
        label = clean_text(first_text(stat.xpath(".//div[contains(@class,'label')]")))
        value = clean_text(first_text(stat.xpath(".//div[contains(@class,'num')]")))
        if label:
            stats[label.lower().replace(" ", "_")] = value
    return stats


def clean_source(section: html.HtmlElement) -> str:
    title_node = first(section.xpath(".//div[contains(@class,'section-title')]"))
    if title_node is None:
        return "unknown"
    source = clean_text(first_text(title_node.xpath("./text()")))
    if source:
        return source
    text = clean_text(title_node.text_content())
    return re.sub(r"\s+(Inventory|RAG)\s*$", "", text).strip() or "unknown"


def parse_specs(card: html.HtmlElement) -> dict[str, str]:
    specs: dict[str, str] = {}
    for item in card.xpath(".//div[contains(@class,'specs')]/div"):
        key = clean_text(first_text(item.xpath(".//span[contains(@class,'k')]")))
        value_nodes = item.xpath("./span[not(contains(@class,'k'))]")
        value = clean_text(value_nodes[0].text_content() if value_nodes else item.text_content())
        if key:
            specs[key] = value.replace(key, "", 1).strip()
    return specs


def parse_make_model(sub: str) -> str | None:
    if not sub:
        return None
    return none_if_empty(sub.split("·")[0])


def parse_condition(sub: str) -> str | None:
    lowered = sub.lower()
    if "·" in sub:
        condition = clean_text(sub.split("·")[-1])
        return condition if condition in {"new", "used"} else condition or None
    if " new" in lowered or lowered.endswith("new"):
        return "new"
    if " used" in lowered or lowered.endswith("used"):
        return "used"
    return None


def parse_eur(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"€\s*([0-9][0-9.\s]*)", value)
    if not match:
        return None
    return parse_int(match.group(1))


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    normalized = clean_text(value)
    if normalized in {"—", "-"}:
        return None
    match = re.search(r"\d[\d.\s]*", normalized)
    if not match:
        return None
    digits = re.sub(r"\D", "", match.group(0))
    return int(digits) if digits else None


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    normalized = clean_text(value)
    if normalized in {"—", "-"}:
        return None
    match = re.search(r"\d+(?:[,.]\d+)?", normalized)
    if not match:
        return None
    return float(match.group(0).replace(",", "."))


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def none_if_empty(value: str | None) -> str | None:
    cleaned = clean_text(value)
    return None if cleaned in {"", "—", "-"} else cleaned


def first(values: list[Any]) -> Any | None:
    return values[0] if values else None


def first_text(values: list[Any]) -> str:
    value = first(values)
    if value is None:
        return ""
    return value if isinstance(value, str) else value.text_content()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_inventory_csv(path: Path, rows: list[InventoryRow]) -> None:
    write_csv(path, [asdict(row) for row in rows], list(InventoryRow.__dataclass_fields__.keys()))


def write_rag_csv(path: Path, rows: list[RagRow]) -> None:
    write_csv(path, [asdict(row) for row in rows], list(RagRow.__dataclass_fields__.keys()))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
