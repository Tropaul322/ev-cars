#!/usr/bin/env python3
"""Fetch a single inventory page via Crawl4AI (browser) or httpx (direct/API).

Invoked by the TypeScript Crawl4AIFetcher. Writes the response body to
--cache-file and exits 0 on success.

Modes:
  direct  - plain HTTP GET (AutoScout24, bmw-boerse SSR pages)
  api     - plain HTTP GET for JSON endpoints (Tesla inventory API)
  html    - headless Chromium via Crawl4AI with optional wait_for selector
  stealth - Crawl4AI with longer post-load delay (willhaben / DataDome)
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import httpx

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}


def write_cache(cache_file: str, body: str) -> None:
    path = Path(cache_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


async def fetch_http(url: str, timeout_s: float = 30.0) -> str:
    async with httpx.AsyncClient(
        headers=BROWSER_HEADERS,
        follow_redirects=True,
        timeout=timeout_s,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


def normalize_wait_for(wait_for: str | None) -> str | None:
    if not wait_for:
        return None
    if wait_for.startswith("css:") or wait_for.startswith("js:"):
        return wait_for
    # Crawl4AI expects css: or js: prefixes.
    if wait_for == "body":
        return "css:body"
    return f"css:{wait_for}"


async def fetch_with_crawl4ai(
    url: str,
    *,
    wait_for: str | None,
    wait_ms: int,
    stealth: bool,
) -> str:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    delay_s = max(wait_ms / 1000, 2.0 if stealth else 1.0)
    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
    )
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        wait_for=normalize_wait_for(wait_for),
        page_timeout=max(wait_ms, 30_000),
        delay_before_return_html=delay_s,
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)
        if not result.success:
            raise RuntimeError(result.error_message or "crawl4ai fetch failed")
        html = result.html or result.cleaned_html or ""
        if not html.strip():
            raise RuntimeError("crawl4ai returned empty HTML")
        return html


async def run(args: argparse.Namespace) -> str:
    if args.polite_delay_ms:
        await asyncio.sleep(args.polite_delay_ms / 1000)

    if args.mode in ("direct", "api"):
        return await fetch_http(args.url, timeout_s=60.0 if args.mode == "api" else 30.0)

    return await fetch_with_crawl4ai(
        args.url,
        wait_for=args.wait_for,
        wait_ms=args.wait_ms,
        stealth=args.mode == "stealth",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch one inventory page for FlowRyd crawler")
    parser.add_argument("--mode", choices=["direct", "api", "html", "stealth"], required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--cache-file", required=True)
    parser.add_argument("--wait-for", default=None)
    parser.add_argument("--wait-ms", type=int, default=8000)
    parser.add_argument("--polite-delay-ms", type=int, default=0)
    args = parser.parse_args()

    try:
        body = asyncio.run(run(args))
        write_cache(args.cache_file, body)
        print(f"crawl4ai: wrote {len(body)} bytes -> {args.cache_file}", file=sys.stderr)
        return 0
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        print(f"crawl4ai fetch failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
