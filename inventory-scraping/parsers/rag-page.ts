// Context (RAG) page parser: extracts heading -> following text blocks for the
// knowledge corpus. For each of the first 20 h1/h2/h3 headings, gathers
// <p>/<li> text in document order until the next heading (or ~1200 chars).
// Falls back to whole-page text if no headings exist.
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RagRecord } from "../types.ts";

const HEADING_TAGS = new Set(["h1", "h2", "h3"]);

function extractText($: cheerio.CheerioAPI, node: AnyNode): string {
  const parts: string[] = [];
  $(node)
    .contents()
    .each((_, child) => {
      if (child.type === "text") {
        const text = (child.data ?? "").trim();
        if (text) parts.push(text);
      } else if (child.type === "tag") {
        const text = extractText($, child);
        if (text) parts.push(text);
      }
    });
  return parts.join(" ");
}

export function parseRagPage(sourceId: string, sourceUrl: string, html: string): RagRecord[] {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const records: RagRecord[] = [];
  const allEls = $("*").toArray();
  const headings = allEls.filter((el) => el.type === "tag" && HEADING_TAGS.has(el.name));

  for (const heading of headings.slice(0, 20)) {
    const startIdx = allEls.indexOf(heading);
    const textParts: string[] = [];

    for (let i = startIdx + 1; i < allEls.length; i++) {
      const el = allEls[i];
      if (el.type !== "tag") continue;
      if (HEADING_TAGS.has(el.name)) break;
      if (el.name === "p" || el.name === "li") {
        const text = extractText($, el).trim();
        if (text) textParts.push(text);
      }
      if (textParts.join(" ").length > 1200) break;
    }

    const text = textParts.join(" ").trim();
    if (text) {
      records.push({
        source: sourceId,
        sourceUrl,
        heading: extractText($, heading).trim() || null,
        text: text.slice(0, 1500)
      });
    }
  }

  if (!records.length) {
    // Whole-document fallback so headingless pages still yield a record.
    const text = extractText($, $.root()[0]).trim();
    if (text) {
      records.push({ source: sourceId, sourceUrl, heading: null, text: text.slice(0, 1500) });
    }
  }

  return records;
}
