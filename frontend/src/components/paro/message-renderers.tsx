"use client";

import { MouseEvent, useCallback, useMemo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { extractRenderableMedia, parseToolResultOutput } from "@/lib/tool-result";
import type { RunLog } from "@/types/paro";

type CodeBlockLabels = {
  copy: string;
  copied: string;
  copyFailed: string;
  download: string;
  downloaded: string;
};

function renderMarkdown(md: string): string {
  const result = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeStringify)
    .processSync(md);
  return String(result);
}

function postProcessHtml(html: string): string {
  html = html.replace(
    /<pre><code class="hljs language-(\w+)">/g,
    '<pre class="code-block" data-language="$1"><code class="hljs language-$1">'
  );

  html = html.replace(
    /<pre><code(?! class="hljs)([^>]*)>/g,
    '<pre class="ascii-diagram"><code$1>'
  );

  html = html.replace(
    /<ol start="(\d+)">/g,
    (_, start) => `<ol style="counter-reset:step-counter ${parseInt(start, 10) - 1}">`
  );

  return html;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inferCodeFilename(language: string): string {
  const normalized = language.trim().toLowerCase();
  const extensionMap: Record<string, string> = {
    bash: "sh",
    c: "c",
    cpp: "cpp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    javascript: "js",
    json: "json",
    jsx: "jsx",
    markdown: "md",
    md: "md",
    python: "py",
    rust: "rs",
    shell: "sh",
    sh: "sh",
    sql: "sql",
    text: "txt",
    ts: "ts",
    tsx: "tsx",
    typescript: "ts",
    yaml: "yml",
    yml: "yml",
  };
  const extension = extensionMap[normalized] || normalized || "txt";
  return `snippet.${extension}`;
}

function enhanceCodeBlocks(html: string, labels: CodeBlockLabels): string {
  if (typeof document === "undefined") return html;

  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll("pre.code-block").forEach((pre) => {
    const language = (pre.getAttribute("data-language") || "text").trim() || "text";
    const shell = document.createElement("div");
    shell.className = "code-block-shell";
    shell.setAttribute("data-language", language);

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";
    toolbar.innerHTML = `
      <span class="code-block-language">${escapeHtmlAttribute(language)}</span>
      <span class="code-block-actions">
        <button
          type="button"
          class="code-block-action"
          data-code-action="copy"
          data-default-label="${escapeHtmlAttribute(labels.copy)}"
          data-success-label="${escapeHtmlAttribute(labels.copied)}"
          data-error-label="${escapeHtmlAttribute(labels.copyFailed)}"
        >${escapeHtmlAttribute(labels.copy)}</button>
        <button
          type="button"
          class="code-block-action"
          data-code-action="download"
          data-default-label="${escapeHtmlAttribute(labels.download)}"
          data-success-label="${escapeHtmlAttribute(labels.downloaded)}"
          data-filename="${escapeHtmlAttribute(inferCodeFilename(language))}"
        >${escapeHtmlAttribute(labels.download)}</button>
      </span>
    `;

    const parent = pre.parentNode;
    if (!parent) return;
    parent.replaceChild(shell, pre);
    shell.appendChild(toolbar);
    shell.appendChild(pre);
  });

  return container.innerHTML;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }

  return copied;
}

function downloadTextFile(filename: string, content: string) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function flashCodeActionLabel(button: HTMLButtonElement, label: string) {
  const defaultLabel = button.dataset.defaultLabel || button.textContent || "";
  const timerId = button.dataset.timerId ? Number(button.dataset.timerId) : null;
  if (timerId) {
    window.clearTimeout(timerId);
  }

  button.textContent = label;
  const nextTimerId = window.setTimeout(() => {
    button.textContent = defaultLabel;
    delete button.dataset.timerId;
  }, 1600);
  button.dataset.timerId = String(nextTimerId);
}

export function AssistantInlineMedia({ text }: { text: string }) {
  const t = useTranslations("paro");
  const mediaItems = useMemo(() => {
    const media = extractRenderableMedia(text);
    return [
      ...media.links.map((link) => ({
        url: link.url,
        type: link.linkType,
      })),
      ...media.images.map((image) => ({
        url: image.url,
        type: "image" as const,
      })),
    ];
  }, [text]);

  if (mediaItems.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {mediaItems.map((item) => (
        <div
          key={`${item.type}:${item.url}`}
          className="w-full overflow-hidden rounded-xl border border-black/8 bg-white/60 p-3 dark:border-white/8 dark:bg-white/5 sm:max-w-[300px]"
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
            {item.type === "audio"
              ? t("result_open_audio")
              : item.type === "video"
                ? t("result_open_video")
                : t("result_open_link")}
          </div>

          {item.type === "audio" ? (
            <audio controls preload="none" className="w-full">
              <source src={item.url} />
            </audio>
          ) : item.type === "video" ? (
            <video controls preload="metadata" className="aspect-video w-full rounded-lg bg-black object-cover">
              <source src={item.url} />
            </video>
          ) : (
            <img src={item.url} alt={t("result_open_link")} className="aspect-[4/3] w-full rounded-lg object-cover" />
          )}

          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center rounded-full border border-black/8 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:border-white/8 dark:hover:bg-white/5"
          >
            {t("result_open_in_new_tab")}
          </a>
        </div>
      ))}
    </div>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const t = useTranslations("paro");
  const html = useMemo(
    () =>
      enhanceCodeBlocks(postProcessHtml(renderMarkdown(text)), {
        copy: t("code_copy"),
        copied: t("code_copied"),
        copyFailed: t("code_copy_failed"),
        download: t("code_download"),
        downloaded: t("code_downloaded"),
      }),
    [text, t]
  );

  const handleCodeAction = useCallback(async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>("[data-code-action]");
    if (!button) return;

    const shell = button.closest<HTMLElement>(".code-block-shell");
    const codeNode = shell?.querySelector("pre code") || shell?.querySelector("pre");
    const codeText = codeNode?.textContent || "";
    if (!codeText) return;

    if (button.dataset.codeAction === "copy") {
      const copied = await copyText(codeText);
      flashCodeActionLabel(button, copied ? button.dataset.successLabel || t("code_copied") : button.dataset.errorLabel || t("code_copy_failed"));
      return;
    }

    if (button.dataset.codeAction === "download") {
      downloadTextFile(button.dataset.filename || "snippet.txt", codeText);
      flashCodeActionLabel(button, button.dataset.successLabel || t("code_downloaded"));
    }
  }, [t]);

  return (
    <div
      className="prose-custom paro-markdown"
      onClick={handleCodeAction}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function getPreviewText(text: string, maxLength = 88): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function isCompactThinkingLog(log: RunLog): boolean {
  return log.kind === "status" || log.kind === "tool_start" || log.kind === "compact" || log.kind === "stopped" || log.kind === "done";
}

export function ThinkingLogItem({ log }: { log: RunLog }) {
  const t = useTranslations("paro");
  const dotStyles = {
    info: "bg-sky-500/80",
    success: "bg-emerald-500/80",
    error: "bg-rose-500/80",
  } as const;
  const parsedOutput = useMemo(() => parseToolResultOutput(log.body), [log.body]);
  const compactLine = isCompactThinkingLog(log) && log.body.trim() && !/\n/.test(log.body);
  const structuredOutput = parsedOutput.kind === "structured" ? parsedOutput : null;
  const textOutput = parsedOutput.text;

  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", dotStyles[log.tone])} />
      <div className="min-w-0 flex-1">
        {compactLine ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:bg-white/[0.08] dark:text-zinc-400">
              {log.title}
            </span>
            <span className="min-w-0 truncate text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
              {log.body}
            </span>
            {log.durationMs ? (
              <span className="shrink-0 rounded-full bg-black/[0.045] px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                {log.durationMs}ms
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="truncate text-[13px] font-medium tracking-[-0.01em] text-zinc-800 dark:text-zinc-100">
                {log.title}
              </div>
              {log.durationMs ? (
                <span className="shrink-0 rounded-full bg-black/[0.045] px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                  {log.durationMs}ms
                </span>
              ) : null}
            </div>
            {structuredOutput || textOutput ? (
              <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200">
                {structuredOutput ? (
                  <>
                    {structuredOutput.text}
                    {structuredOutput.fields.length > 0 ? (
                      <div className="mt-1 space-y-1.5">
                        {structuredOutput.fields.map((field) => (
                          <div key={field.key} className="min-w-0">
                            <div className="text-[10px] font-medium tracking-[0.14em] text-zinc-500 uppercase dark:text-zinc-400">
                              {field.label}
                            </div>
                            <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-700 dark:text-zinc-200">
                              {field.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  textOutput
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
      {log.kind === "tool_result" ? (
        <span className="shrink-0 rounded-full bg-black/[0.045] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
          {t("runtime_tool")}
        </span>
      ) : null}
    </div>
  );
}

export function ThinkingOutputItem({ text }: { text: string }) {
  const t = useTranslations("paro");

  return (
    <article className="rounded-[22px] bg-black/[0.02] px-4 py-4 dark:bg-white/[0.035]">
      <div className="mb-2 text-[10px] font-medium tracking-[0.14em] text-zinc-500 uppercase dark:text-zinc-400">
        {t("runtime_model_output")}
      </div>
      <AssistantMarkdown text={text} />
    </article>
  );
}

export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="thinking-dot h-1.5 w-1.5 rounded-full bg-current"
          style={{ animationDelay: `${dot * 220}ms` }}
        />
      ))}
    </span>
  );
}
