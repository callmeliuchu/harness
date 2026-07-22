import { extractRenderableMedia } from "@/lib/tool-result";

export function toMediaOnlyOutput(output: string): string | null {
  const media = extractRenderableMedia(output);
  if (media.links.length === 0 && media.images.length === 0) return null;

  const mediaPayload: Record<string, string> = {};
  media.links.forEach((link, idx) => {
    const key = `${link.linkType}_url_${idx + 1}`;
    mediaPayload[key] = link.url;
  });
  media.images.forEach((image, idx) => {
    const key = `img_url_${idx + 1}`;
    mediaPayload[key] = image.url;
  });

  return JSON.stringify(mediaPayload);
}
