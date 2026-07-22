"use client";

import Image from "next/image";
import {
  AssistantInlineMedia,
  AssistantMarkdown,
  ThinkingDots,
} from "@/components/paro/message-renderers";
import { RuntimeLog } from "@/components/paro/runtime-log";
import { ToolResultView } from "@/components/paro/tool-result-view";
import { withBasePath } from "@/lib/base-path";
import { toMediaOnlyOutput } from "@/lib/media-output";
import { cn } from "@/lib/utils";
import type { Turn } from "@/types/paro";

type TurnViewLabels = {
  currentSkillLabel: string;
  paro: string;
  stopping: string;
  thinkingLabel: string;
};

type TurnViewProps = {
  isMobileApp: boolean;
  thinkingOpen: boolean;
  turn: Turn;
  labels: TurnViewLabels;
  onToggleThinking: (turnId: string) => void;
  setLiveLogRef: (turnId: string, node: HTMLDivElement | null) => void;
};

export function TurnView({
  isMobileApp,
  thinkingOpen,
  turn,
  labels,
  onToggleThinking,
  setLiveLogRef,
}: TurnViewProps) {
  const finalMediaOutput = turn.mediaOutput
    ? toMediaOnlyOutput(turn.mediaOutput)
    : toMediaOnlyOutput(turn.assistantText);
  const isThinkingActive = turn.status === "streaming" || turn.status === "stopping";

  return (
    <div className={cn(isMobileApp ? "space-y-3" : "space-y-4")}>
      <div className="flex justify-end">
        <div
          className={cn(
            "w-full border border-black/8 bg-zinc-100 text-zinc-900 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.18)] dark:border-white/8 dark:bg-white/8 dark:text-zinc-100",
            isMobileApp
              ? "max-w-[84%] rounded-2xl px-4 py-3"
              : "max-w-[66.666%] rounded-[26px] px-5 py-4"
          )}
        >
          <div className="whitespace-pre-wrap break-words text-[13px] leading-7">
            {turn.userText}
          </div>
        </div>
      </div>

      <div className="flex justify-start">
        <div
          className={cn(
            "w-full border border-black/8 bg-white/92 text-[var(--color-text)] shadow-[0_16px_48px_-40px_rgba(0,0,0,0.3)] dark:border-white/8 dark:bg-[#111216]",
            isMobileApp ? "rounded-2xl px-4 py-3" : "rounded-[26px] px-5 py-4"
          )}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] opacity-80">
              <Image
                src={withBasePath("/brand/aparo.png")}
                alt={labels.paro}
                width={16}
                height={16}
                className="h-4 w-4 rounded-full object-cover"
              />
              {labels.paro}
            </div>
            {turn.selectedSkills.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className="rounded-full border border-black/8 bg-black/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:border-white/8 dark:bg-white/[0.04] dark:text-zinc-300">
                  {labels.currentSkillLabel}
                </span>
                {turn.selectedSkills.map((skill) => (
                  <span
                    key={`${turn.id}:${skill}`}
                    className="rounded-full border border-black/8 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:border-white/8 dark:bg-white/[0.06] dark:text-zinc-100"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>

          <RuntimeLog
            isThinkingActive={isThinkingActive}
            thinkingLabel={labels.thinkingLabel}
            thinkingOpen={thinkingOpen}
            turn={turn}
            onToggleThinking={onToggleThinking}
            setLiveLogRef={setLiveLogRef}
          />

          {turn.status !== "streaming" && finalMediaOutput && (
            <div className="mb-4">
              <ToolResultView output={finalMediaOutput} mediaOnly showOpenLink={false} />
            </div>
          )}

          {!isThinkingActive && turn.assistantText ? (
            <>
              <AssistantMarkdown text={turn.assistantText} />
              {!finalMediaOutput && <AssistantInlineMedia text={turn.assistantText} />}
            </>
          ) : (turn.status === "streaming" || turn.status === "stopping") && turn.logs.length === 0 && !turn.assistantText ? (
            <div className="inline-flex max-w-full items-start gap-2 rounded-2xl border border-black/8 bg-zinc-950/[0.03] px-3 py-2 text-xs text-zinc-600 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-300">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span>{turn.status === "stopping" ? labels.stopping : labels.thinkingLabel}</span>
                  <ThinkingDots className="text-zinc-500 dark:text-zinc-400" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
