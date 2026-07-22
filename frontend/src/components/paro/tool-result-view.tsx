"use client";

import { parseToolResultOutput } from "@/lib/tool-result";
import { useTranslations } from "@/lib/i18n";

export function ToolResultView({
  output,
  mediaOnly = false,
  showOpenLink = true,
  density = "compact",
  chrome = "default",
}: {
  output: string;
  mediaOnly?: boolean;
  showOpenLink?: boolean;
  density?: "compact" | "comfortable";
  chrome?: "default" | "minimal";
}) {
  const t = useTranslations("paro");
  const parsed = parseToolResultOutput(output);
  const isComfortable = density === "comfortable";
  const isMinimal = chrome === "minimal";

  if (parsed.kind === "text") {
    return (
      <div
        className={isComfortable
          ? isMinimal
            ? "whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200"
            : "whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200"
          : "whitespace-pre-wrap break-words"}
      >
        {parsed.text}
      </div>
    );
  }

  const mediaLinks = parsed.links.filter((link) => link.linkType === "audio" || link.linkType === "video");
  const fileLinks = parsed.links.filter((link) => link.linkType === "file");
  const dedupedImages = Array.from(
    new Map(parsed.images.map((image) => [image.url, image])).values()
  );
  const posterUrl = dedupedImages[0]?.url;
  const galleryImages =
    mediaLinks.length > 0 && posterUrl
      ? dedupedImages.filter((image) => image.url !== posterUrl)
      : dedupedImages;

  return (
    <div className={isComfortable ? "space-y-4" : "space-y-3"}>
      {!mediaOnly && parsed.text && (
        <div
          className={
            isComfortable
              ? isMinimal
                ? "whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200"
                : "whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200"
              : "whitespace-pre-wrap break-words text-xs leading-5 text-inherit"
          }
        >
          {parsed.text}
        </div>
      )}

      {mediaLinks.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {mediaLinks.map((link) => (
            <div
              key={`${link.key}:${link.url}`}
              className={
                isMinimal
                  ? "w-full overflow-hidden rounded-2xl bg-transparent p-0 sm:max-w-[360px]"
                  : isComfortable
                    ? "w-full overflow-hidden rounded-2xl border border-black/8 bg-white/70 p-4 shadow-[0_10px_30px_-28px_rgba(0,0,0,0.28)] dark:border-white/8 dark:bg-white/5 sm:max-w-[360px]"
                    : "w-full overflow-hidden rounded-xl border border-black/8 bg-white/60 p-3 dark:border-white/8 dark:bg-white/5 sm:max-w-[340px]"
              }
            >
              {posterUrl && link.linkType === "audio" && (
                <img
                  src={posterUrl}
                  alt={link.label}
                  className={
                    isMinimal
                      ? "mb-3 aspect-[4/3] w-full rounded-xl object-cover"
                      : isComfortable
                        ? "mb-3 aspect-[4/3] w-full rounded-xl object-cover"
                        : "mb-3 aspect-[4/3] w-full rounded-lg object-cover"
                  }
                />
              )}

              <div
                className={
                  isMinimal
                    ? "mb-2 text-[10px] font-medium tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
                    : isComfortable
                      ? "mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70"
                      : "mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70"
                }
              >
                {link.linkType === "audio" ? t("result_open_audio") : t("result_open_video")} · {link.label}
              </div>

              {link.linkType === "audio" ? (
                <audio controls preload="none" className="w-full">
                  <source src={link.url} />
                </audio>
              ) : (
                <video
                  controls
                  preload="metadata"
                  poster={posterUrl}
                  className="aspect-video w-full rounded-lg bg-black object-cover"
                >
                  <source src={link.url} />
                </video>
              )}

              {showOpenLink && (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className={
                    isMinimal
                      ? "mt-3 inline-flex items-center rounded-full bg-black/[0.04] px-3.5 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:bg-white/[0.1]"
                      : isComfortable
                        ? "mt-3 inline-flex items-center rounded-full border border-black/8 px-4 py-2 text-[11px] font-medium transition-colors hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
                        : "mt-2 inline-flex items-center rounded-full border border-black/8 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
                  }
                >
                  {t("result_open_in_new_tab")}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {galleryImages.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {galleryImages.map((image) => (
            showOpenLink ? (
              <a
                key={`${image.key}:${image.url}`}
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className={
                  isMinimal
                    ? "w-full overflow-hidden rounded-2xl bg-transparent transition-opacity hover:opacity-95 sm:max-w-[240px]"
                    : isComfortable
                      ? "w-full overflow-hidden rounded-2xl border border-black/8 bg-white/70 transition-transform transition-opacity hover:-translate-y-0.5 hover:opacity-90 dark:border-white/8 dark:bg-white/5 sm:max-w-[240px]"
                      : "w-full overflow-hidden rounded-xl border border-black/8 bg-white/60 transition-opacity hover:opacity-90 dark:border-white/8 dark:bg-white/5 sm:max-w-[220px]"
                }
              >
                <img
                  src={image.url}
                  alt={image.label}
                  className={
                    isMinimal
                      ? "aspect-[4/3] w-full object-cover"
                      : isComfortable
                        ? "aspect-[4/3] w-full object-cover"
                        : "aspect-[4/3] w-full object-cover"
                  }
                />
                <div
                  className={
                    isMinimal
                      ? "px-0 py-2 text-[11px] text-zinc-500 dark:text-zinc-400"
                      : isComfortable
                        ? "border-t border-black/8 px-4 py-2.5 text-[11px] dark:border-white/8"
                        : "border-t border-black/8 px-3 py-2 text-[11px] dark:border-white/8"
                  }
                >
                  {image.label}
                </div>
              </a>
            ) : (
              <div
                key={`${image.key}:${image.url}`}
                className={
                  isMinimal
                    ? "w-full overflow-hidden rounded-2xl bg-transparent sm:max-w-[240px]"
                    : isComfortable
                      ? "w-full overflow-hidden rounded-2xl border border-black/8 bg-white/70 dark:border-white/8 dark:bg-white/5 sm:max-w-[240px]"
                      : "w-full overflow-hidden rounded-xl border border-black/8 bg-white/60 dark:border-white/8 dark:bg-white/5 sm:max-w-[220px]"
                }
              >
                <img
                  src={image.url}
                  alt={image.label}
                  className={
                    isMinimal
                      ? "aspect-[4/3] w-full object-cover"
                      : isComfortable
                        ? "aspect-[4/3] w-full object-cover"
                        : "aspect-[4/3] w-full object-cover"
                  }
                />
                <div
                  className={
                    isMinimal
                      ? "px-0 py-2 text-[11px] text-zinc-500 dark:text-zinc-400"
                      : isComfortable
                        ? "border-t border-black/8 px-4 py-2.5 text-[11px] dark:border-white/8"
                        : "border-t border-black/8 px-3 py-2 text-[11px] dark:border-white/8"
                  }
                >
                  {image.label}
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {!mediaOnly && fileLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileLinks.map((link) => (
            <a
              key={`${link.key}:${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className={
                isMinimal
                  ? "inline-flex min-h-[38px] items-center rounded-full bg-black/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:bg-white/[0.1]"
                  : isComfortable
                    ? "inline-flex min-h-[40px] items-center rounded-full border border-black/8 px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
                    : "inline-flex min-h-[40px] items-center rounded-full border border-black/8 px-4 py-2 text-xs font-medium transition-colors hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
              }
            >
              {t("result_open_link")}: {link.label}
            </a>
          ))}
        </div>
      )}

      {!mediaOnly && parsed.fields.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {parsed.fields.map((field) => (
            <div
              key={field.key}
              className={
                isMinimal
                  ? "rounded-2xl bg-transparent px-0 py-1.5"
                  : isComfortable
                    ? "rounded-2xl border border-black/8 bg-zinc-950/[0.03] px-4 py-3 dark:border-white/8 dark:bg-white/[0.03]"
                    : "rounded-xl border border-black/8 bg-black/[0.02] px-3 py-2 dark:border-white/8 dark:bg-white/[0.03]"
              }
            >
              <div className={isMinimal ? "text-[10px] font-medium tracking-[0.08em] text-zinc-500 dark:text-zinc-400" : isComfortable ? "text-[10px] uppercase tracking-[0.18em] opacity-70" : "text-[10px] uppercase tracking-[0.18em] opacity-70"}>{field.label}</div>
              <div className={isComfortable ? "mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200" : "mt-1 whitespace-pre-wrap break-words text-xs leading-5"}>
                {field.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
