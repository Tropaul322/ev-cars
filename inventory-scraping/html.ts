import crypto from "node:crypto";
import type { VehicleImage } from "../lib/types.ts";

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function extractTitle(html: string) {
  return (
    extractMeta(html, "og:title") ??
    extractMeta(html, "twitter:title") ??
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  )?.trim() ?? null;
}

export function extractCanonicalUrl(html: string, baseUrl: string) {
  const href = firstMatch(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  return href ? absoluteUrl(href, baseUrl) : null;
}

export function extractMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyPattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const contentFirstPattern = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    "i"
  );
  return decodeHtml(firstMatch(html, propertyPattern) ?? firstMatch(html, contentFirstPattern) ?? "");
}

export function extractMetaMap(html: string) {
  const map = new Map<string, string>();
  const pattern = /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    map.set(match[1], decodeHtml(match[2]));
  }
  return map;
}

export function extractJsonLd(html: string): unknown[] {
  const values: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try {
      values.push(JSON.parse(raw));
    } catch {
      const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
      try {
        values.push(JSON.parse(cleaned));
      } catch {
        // Keep crawling even if one embedded blob is malformed.
      }
    }
  }
  return values;
}

export function flattenJsonLd(values: unknown[]) {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    nodes.push(object);
    if (Array.isArray(object["@graph"])) visit(object["@graph"]);
    if (Array.isArray(object.itemListElement)) visit(object.itemListElement);
    if (object.item && typeof object.item === "object") visit(object.item);
  };
  visit(values);
  return nodes;
}

export function extractLinks(html: string, baseUrl: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)) {
    const url = absoluteUrl(decodeHtml(match[1]), baseUrl);
    if (url) links.add(url);
  }
  return [...links];
}

export function extractPathUrls(html: string, baseUrl: string, pathPattern: RegExp) {
  const links = new Set<string>();
  const flags = pathPattern.flags.includes("g") ? pathPattern.flags : `${pathPattern.flags}g`;
  const pattern = new RegExp(pathPattern.source, flags);

  for (const match of html.matchAll(pattern)) {
    const path = match[1] ?? match[0];
    const url = absoluteUrl(path, baseUrl);
    if (url) links.add(url);
  }

  return [...links];
}

export function extractImages(html: string, baseUrl: string): VehicleImage[] {
  const images: VehicleImage[] = [];
  const seen = new Set<string>();
  const add = (image: VehicleImage | null) => {
    if (!image?.url) return;
    const normalizedUrl = normalizeHighResImageUrl(image.url);
    if (!/^https?:\/\//i.test(normalizedUrl)) return;
    if (isLikelyDecorativeImage(normalizedUrl)) return;
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    images.push({ ...image, url: normalizedUrl });
  };

  for (const key of ["og:image", "twitter:image", "image"]) {
    const image = extractMeta(html, key);
    if (image) add({ url: absoluteUrl(image, baseUrl) ?? image, source: key });
  }

  for (const match of html.matchAll(/<(?:img|source)[^>]+(?:srcset|data-srcset)=["']([^"']+)["'][^>]*>/gi)) {
    add(parseBestSrcsetCandidate(match[1], baseUrl));
  }

  for (const match of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteUrl(decodeHtml(match[1]), baseUrl);
    if (url) add({ url, source: "img" });
  }

  for (const match of html.matchAll(/https?:\/\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<]*)?/gi)) {
    add({ url: decodeHtml(match[0]), source: "inline" });
  }

  return images.sort((a, b) => imageScore(b) - imageScore(a)).slice(0, 24);
}

export function htmlToText(html: string) {
  return compactWhitespace(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

export function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseBestSrcsetCandidate(srcset: string, baseUrl: string): VehicleImage | null {
  const candidates = srcset
    .split(",")
    .map((candidate): VehicleImage | null => {
      const [rawUrl, rawSize] = candidate.trim().split(/\s+/);
      const width = rawSize?.endsWith("w") ? Number(rawSize.slice(0, -1)) : null;
      const url = absoluteUrl(decodeHtml(rawUrl), baseUrl);
      return url ? { url, width: Number.isFinite(width) ? width : null, source: "srcset" } : null;
    })
    .filter((candidate): candidate is VehicleImage => Boolean(candidate));

  return candidates.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? null;
}

function normalizeHighResImageUrl(value: string) {
  return value
    .replace(/([?&](?:width|w|height|h|size)=)\d+/gi, "$11920")
    .replace(/([?&](?:quality|q)=)\d+/gi, "$195")
    .replace(/\/\d+x\d+\//g, "/1920x1080/");
}

function imageScore(image: VehicleImage) {
  let score = 0;
  if (image.width) score += Math.min(image.width, 2400);
  if (/vehicle|car|auto|bilder|image|photo|cdn/i.test(image.url)) score += 300;
  if (/1920|1200|1080|large|full|xl/i.test(image.url)) score += 250;
  if (/webp|jpe?g/i.test(image.url)) score += 80;
  return score;
}

function isLikelyDecorativeImage(url: string) {
  return /(logo|sprite|icon|favicon|placeholder|avatar|blank|tracking|pixel)/i.test(url);
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match?.[1] ? decodeHtml(match[1]) : null;
}
