type Primitive = string | number | boolean | null;

export type ToolResultField = {
  key: string;
  label: string;
  value: string;
};

export type ToolResultLink = {
  key: string;
  label: string;
  url: string;
  linkType: "audio" | "video" | "file";
};

export type ToolResultImage = {
  key: string;
  label: string;
  url: string;
};

export type ParsedToolResult =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "structured";
      rawText: string;
      text: string;
      fields: ToolResultField[];
      links: ToolResultLink[];
      images: ToolResultImage[];
    };

export type ExtractedRenderableMedia = {
  links: ToolResultLink[];
  images: ToolResultImage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isImageKey(key: string): boolean {
  return /(img|image|cover|poster|thumbnail|封面|图片|图像)/i.test(key);
}

function isAudioKey(key: string): boolean {
  return /(music|audio|song|voice|mp3|wav|试听|play|音乐|音频|歌曲|播放)/i.test(key);
}

function isVideoKey(key: string): boolean {
  return /(video|movie|mv|mp4|webm|mov|影片|视频|短片|录像)/i.test(key);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getUrlMetadata(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = [parsed.pathname, safeDecodeURIComponent(parsed.pathname)];
    for (const [key, value] of parsed.searchParams.entries()) {
      parts.push(key, value, safeDecodeURIComponent(value));
    }
    return parts.join(" ");
  } catch {
    return url;
  }
}

function isImageUrl(url: string): boolean {
  const metadata = getUrlMetadata(url);
  return (
    /\.(png|jpe?g|gif|webp|svg)(?:$|[?#&])/i.test(metadata) ||
    /\bimage\/(png|jpe?g|gif|webp|svg(?:\+xml)?)\b/i.test(metadata)
  );
}

function isAudioUrl(url: string): boolean {
  const metadata = getUrlMetadata(url);
  return (
    /\.(mp3|wav|m4a|aac|flac|ogg|opus)(?:$|[?#&])/i.test(metadata) ||
    /\baudio\/(mpeg|mp3|wav|x-wav|mp4|aac|flac|ogg|opus)\b/i.test(metadata)
  );
}

function isVideoUrl(url: string): boolean {
  const metadata = getUrlMetadata(url);
  return (
    /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#&])/i.test(metadata) ||
    /\bvideo\/(mp4|webm|quicktime|ogg)\b/i.test(metadata)
  );
}

function normalizeLabel(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || "link";
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function sanitizeDetectedUrl(url: string): string {
  let sanitized = url.trim();
  sanitized = sanitized.replace(/&quot;?$/gi, "");
  sanitized = sanitized.replace(/(?:\\+["']?|["'`])+\s*$/g, "");
  sanitized = sanitized.replace(/[),.;!?]+$/g, "");
  sanitized = sanitized.replace(/(?:\\+["']?|["'`])+\s*$/g, "");
  return sanitized.trim();
}

function normalizeMediaLabel(label: string): string {
  return normalizeLabel(stripHtmlTags(label).replace(/\s+/g, " ").trim() || "link");
}

function resolveMediaType(
  url: string,
  label: string,
  forcedType?: ToolResultLink["linkType"] | "image"
): ToolResultLink["linkType"] | "image" | null {
  if (forcedType) return forcedType;

  if (isImageKey(label) || isImageUrl(url)) return "image";
  if (isVideoKey(label) || isVideoUrl(url)) return "video";
  if (isAudioKey(label) || isAudioUrl(url)) return "audio";
  return null;
}

function parseHtmlAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributeRegex = /([\w:-]+)\s*=\s*(['"])(.*?)\2/gs;
  let match: RegExpExecArray | null;

  while ((match = attributeRegex.exec(fragment)) !== null) {
    attributes[match[1].toLowerCase()] = match[3];
  }

  return attributes;
}

function getContextHint(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const prefix = text
    .slice(lineStart, index)
    .replace(/[*_`>#]/g, " ")
    .replace(/\[[^\]]*$/g, " ")
    .trim();
  const segments = prefix.split(/[：:]/).map((segment) => segment.trim()).filter(Boolean);
  return segments[segments.length - 1] || prefix.slice(-32);
}

function pushDetectedMedia(
  collection: ExtractedRenderableMedia,
  seen: Set<string>,
  url: string,
  labelHint: string,
  forcedType?: ToolResultLink["linkType"] | "image",
  displayLabel?: string
) {
  const sanitizedUrl = sanitizeDetectedUrl(url);
  if (!sanitizedUrl) return;

  const normalizedLabel = normalizeMediaLabel(displayLabel || labelHint);
  const mediaType = resolveMediaType(
    sanitizedUrl,
    normalizeMediaLabel(labelHint),
    forcedType
  );
  if (!mediaType) return;

  const dedupeKey = sanitizedUrl;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);

  if (mediaType === "image") {
    collection.images.push({ key: normalizedLabel, label: normalizedLabel, url: sanitizedUrl });
    return;
  }

  collection.links.push({
    key: normalizedLabel,
    label: normalizedLabel,
    url: sanitizedUrl,
    linkType: mediaType,
  });
}

function compactText(text: string): string {
  return text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushUrlEntry(
  key: string,
  url: string,
  links: ToolResultLink[],
  images: ToolResultImage[]
) {
  const sanitizedUrl = sanitizeDetectedUrl(url);
  if (!sanitizedUrl) return;
  const label = normalizeLabel(key);
  if (isImageKey(label) || isImageUrl(sanitizedUrl)) {
    images.push({ key: label, label, url: sanitizedUrl });
    return;
  }

  let linkType: ToolResultLink["linkType"] = "file";
  if (isVideoKey(label) || isVideoUrl(sanitizedUrl)) {
    linkType = "video";
  } else if (isAudioKey(label) || isAudioUrl(sanitizedUrl)) {
    linkType = "audio";
  }

  links.push({
    key: label,
    label,
    url: sanitizedUrl,
    linkType,
  });
}

function collectInlineMedia(text: string): ExtractedRenderableMedia {
  const media: ExtractedRenderableMedia = { links: [], images: [] };
  const seen = new Set<string>();

  const markdownImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let markdownImageMatch: RegExpExecArray | null;
  while ((markdownImageMatch = markdownImageRegex.exec(text)) !== null) {
    pushDetectedMedia(media, seen, markdownImageMatch[2], markdownImageMatch[1] || "image", "image");
  }

  const htmlMediaTagRegex = /<(img|audio|video|source)\b[^>]*>/gi;
  let htmlMediaTagMatch: RegExpExecArray | null;
  while ((htmlMediaTagMatch = htmlMediaTagRegex.exec(text)) !== null) {
    const tagName = htmlMediaTagMatch[1].toLowerCase();
    const attrs = parseHtmlAttributes(htmlMediaTagMatch[0]);
    const src = attrs.src;
    if (!src || !/^https?:\/\//i.test(src)) continue;

    let forcedType: ToolResultLink["linkType"] | "image" | undefined;
    if (tagName === "img") {
      forcedType = "image";
    } else if (tagName === "audio" || tagName === "video") {
      forcedType = tagName;
    } else {
      const declaredType = String(attrs.type || "").toLowerCase();
      if (declaredType.startsWith("audio/")) forcedType = "audio";
      else if (declaredType.startsWith("video/")) forcedType = "video";
    }
    pushDetectedMedia(media, seen, src, attrs.alt || attrs.title || tagName, forcedType);
  }

  const markdownLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let markdownLinkMatch: RegExpExecArray | null;
  while ((markdownLinkMatch = markdownLinkRegex.exec(text)) !== null) {
    const contextHint = getContextHint(text, markdownLinkMatch.index);
    const labelHint = [contextHint, markdownLinkMatch[1]].filter(Boolean).join(" ");
    pushDetectedMedia(
      media,
      seen,
      markdownLinkMatch[2],
      labelHint || "link",
      undefined,
      markdownLinkMatch[1] || "link"
    );
  }

  const htmlAnchorRegex = /<a\b[^>]*\bhref=(['"])(https?:\/\/[^"'<>]+)\1[^>]*>(.*?)<\/a>/gis;
  let htmlAnchorMatch: RegExpExecArray | null;
  while ((htmlAnchorMatch = htmlAnchorRegex.exec(text)) !== null) {
    const contextHint = getContextHint(text, htmlAnchorMatch.index);
    const labelHint = [contextHint, htmlAnchorMatch[3]].filter(Boolean).join(" ");
    pushDetectedMedia(
      media,
      seen,
      htmlAnchorMatch[2],
      labelHint || "link",
      undefined,
      htmlAnchorMatch[3] || "link"
    );
  }

  const bareUrlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  let bareUrlMatch: RegExpExecArray | null;
  while ((bareUrlMatch = bareUrlRegex.exec(text)) !== null) {
    pushDetectedMedia(
      media,
      seen,
      bareUrlMatch[0],
      getContextHint(text, bareUrlMatch.index)
    );
  }

  return media;
}

function collectNestedUrls(
  value: unknown,
  keyHint: string,
  links: ToolResultLink[],
  images: ToolResultImage[],
  seen: Set<string>
) {
  if (isUrl(value)) {
    const dedupeKey = `${keyHint}::${value}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    pushUrlEntry(keyHint, value, links, images);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedUrls(item, keyHint, links, images, seen);
    }
    return;
  }

  if (!isRecord(value)) return;
  for (const [key, next] of Object.entries(value)) {
    collectNestedUrls(next, key, links, images, seen);
  }
}

function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === open) {
      depth += 1;
      continue;
    }

    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseJsonFragment(output: string):
  | { parsed: unknown; start: number; end: number }
  | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const start = output.indexOf(trimmed);
    return { parsed, start: Math.max(0, start), end: Math.max(0, start) + trimmed.length };
  } catch {
    // Continue to embedded JSON parsing.
  }

  for (let i = 0; i < output.length; i += 1) {
    const ch = output[i];
    if (ch !== "{" && ch !== "[") continue;

    const candidate = extractBalancedJson(output, i);
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(candidate);
      return { parsed, start: i, end: i + candidate.length };
    } catch {
      // Keep searching for the next candidate.
    }
  }

  return null;
}

function parseStructuredFromJson(output: string, parsed: unknown, start: number, end: number): ParsedToolResult {
  const fields: ToolResultField[] = [];
  const links: ToolResultLink[] = [];
  const images: ToolResultImage[] = [];
  const seen = new Set<string>();

  const surroundingText = compactText(`${output.slice(0, start)}\n${output.slice(end)}`);

  if (isRecord(parsed)) {
    for (const [key, value] of Object.entries(parsed)) {
      if (isUrl(value)) {
        collectNestedUrls(value, key, links, images, seen);
        continue;
      }

      collectNestedUrls(value, key, links, images, seen);
      const primitiveValue = value as Primitive | unknown[] | Record<string, unknown>;
      fields.push({ key, label: key, value: toFieldValue(primitiveValue) });
    }
  } else if (Array.isArray(parsed)) {
    collectNestedUrls(parsed, "link", links, images, seen);
    fields.push({ key: "result", label: "result", value: toFieldValue(parsed) });
  } else {
    return parsePlainTextOutput(output);
  }

  if (!fields.length && !links.length && !images.length) {
    return { kind: "text", text: output };
  }

  return {
    kind: "structured",
    rawText: output,
    text: surroundingText,
    fields,
    links,
    images,
  };
}

function parsePlainTextOutput(output: string): ParsedToolResult {
  const lines = output.split("\n");
  const fields: ToolResultField[] = [];
  const links: ToolResultLink[] = [];
  const images: ToolResultImage[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*"?([^:"\n]+?)"?\s*[：:]\s*"?((?:https?:\/\/)[^"\s,]+)"?\s*,?\s*$/u);
    if (match) {
      const [, key, url] = match;
      pushUrlEntry(key.trim(), url, links, images);
      continue;
    }

    textLines.push(line);
  }

  if (!links.length && !images.length && !fields.length) {
    return { kind: "text", text: output };
  }

  const text = textLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    kind: "structured",
    rawText: output,
    text,
    fields,
    links,
    images,
  };
}

function toFieldValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export function parseToolResultOutput(output: string): ParsedToolResult {
  if (!output.trim()) {
    return { kind: "text", text: output };
  }

  const jsonFragment = parseJsonFragment(output);
  if (jsonFragment) {
    return parseStructuredFromJson(
      output,
      jsonFragment.parsed,
      jsonFragment.start,
      jsonFragment.end
    );
  }

  return parsePlainTextOutput(output);
}

export function extractRenderableMedia(output: string): ExtractedRenderableMedia {
  const parsed = parseToolResultOutput(output);
  const media: ExtractedRenderableMedia = { links: [], images: [] };
  const seen = new Set<string>();

  if (parsed.kind === "structured") {
    for (const link of parsed.links) {
      if (link.linkType !== "audio" && link.linkType !== "video") continue;
      pushDetectedMedia(media, seen, link.url, link.label, link.linkType);
    }
    for (const image of parsed.images) {
      pushDetectedMedia(media, seen, image.url, image.label, "image");
    }
  }

  const inlineMedia = collectInlineMedia(output);
  for (const link of inlineMedia.links) {
    pushDetectedMedia(media, seen, link.url, link.label, link.linkType);
  }
  for (const image of inlineMedia.images) {
    pushDetectedMedia(media, seen, image.url, image.label, "image");
  }

  return media;
}
