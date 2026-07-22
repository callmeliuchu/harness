"use client";

import { ChevronRight } from "lucide-react";
import {
  ThinkingDots,
  ThinkingLogItem,
  ThinkingOutputItem,
  getPreviewText,
} from "@/components/paro/message-renderers";
import { cn } from "@/lib/utils";
import type { Turn } from "@/types/paro";

type RuntimeLogProps = {
  isThinkingActive: boolean;
  thinkingLabel: string;
  thinkingOpen: boolean;
  turn: Turn;
  onToggleThinking: (turnId: string) => void;
  setLiveLogRef: (turnId: string, node: HTMLDivElement | null) => void;
};

export function RuntimeLog({
  isThinkingActive,
  thinkingLabel,
  thinkingOpen,
  turn,
  onToggleThinking,
  setLiveLogRef,
}: RuntimeLogProps) {
  const latestThinkingLog = turn.logs[turn.logs.length - 1];
  const thinkingPreview = latestThinkingLog
    ? latestThinkingLog.body.trim()
      ? `${latestThinkingLog.title} · ${getPreviewText(latestThinkingLog.body, 56)}`
      : latestThinkingLog.title
    : turn.assistantText
      ? getPreviewText(turn.assistantText)
      : "";

  if (turn.logs.length === 0 && !(isThinkingActive && !!turn.assistantText)) {
    return null;
  }

  return (
    <div className="mb-4 overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.72))] px-4 py-3 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.035))]">
      <button
        type="button"
        onClick={() => onToggleThinking(turn.id)}
        className="group flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={thinkingOpen}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300">
            {isThinkingActive ? (
              <ThinkingDots className="text-zinc-500 dark:text-zinc-400" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-current opacity-60" />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
              {thinkingLabel}
            </div>
            {thinkingPreview && (
              <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {thinkingPreview}
              </div>
            )}
          </div>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300">
            {turn.logs.length}
          </span>
          <ChevronRight
            size={14}
            className={cn(
              "text-zinc-400 transition-transform duration-200 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300",
              thinkingOpen && "rotate-90"
            )}
          />
        </div>
      </button>
      {thinkingOpen && (
        <div
          ref={(node) => setLiveLogRef(turn.id, node)}
          className={cn("mt-3 max-h-72 space-y-2.5 overflow-y-auto pr-1.5", isThinkingActive && "scroll-smooth")}
        >
          {turn.logs.map((log) => (
            <ThinkingLogItem key={log.id} log={log} />
          ))}
          {turn.assistantText && (
            <ThinkingOutputItem text={turn.assistantText} />
          )}
        </div>
      )}
    </div>
  );
}
