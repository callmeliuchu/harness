"use client";

import { ChevronRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionItem } from "@/types/paro";

type SessionSidebarLabels = {
  currentSession: string;
  newSession: string;
  sidebarSessions: string;
  sessionEmpty: string;
};

type SessionSidebarProps = {
  latestUserPrompt?: string;
  loadingSessionId: string | null;
  model: string;
  sessions: SessionItem[];
  workspace: string;
  onLoadSession: (sessionId: string) => void;
  onResetSession: () => void;
  labels: SessionSidebarLabels;
};

export function SessionSidebar({
  latestUserPrompt,
  loadingSessionId,
  model,
  sessions,
  workspace,
  onLoadSession,
  onResetSession,
  labels,
}: SessionSidebarProps) {
  return (
    <aside className="hidden w-[216px] shrink-0 border-r border-black/6 bg-white/72 backdrop-blur dark:border-white/6 dark:bg-[#101114] xl:flex xl:flex-col">
      <div className="border-b border-black/6 px-5 py-4 dark:border-white/6">
        <button
          type="button"
          onClick={onResetSession}
          title={labels.newSession}
          aria-label={labels.newSession}
          className="flex w-full items-center justify-center rounded-2xl border border-black/8 bg-white px-4 py-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
        >
          {labels.newSession}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {labels.sidebarSessions}
        </div>

        <div className="space-y-2">
          <div className="rounded-2xl bg-zinc-950/6 px-4 py-3 dark:bg-white/6">
            <div className="flex items-center gap-2 text-xs font-medium">
              <MessageSquare size={15} />
              {labels.currentSession}
            </div>
            <div className="mt-2 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
              {latestUserPrompt || labels.sessionEmpty}
            </div>
          </div>

          {sessions.map((session) => (
            <button
              key={session.session_id}
              type="button"
              onClick={() => onLoadSession(session.session_id)}
              className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5"
            >
              <div className="line-clamp-2 text-xs text-zinc-700 dark:text-zinc-200">
                {session.preview || labels.sessionEmpty}
              </div>
              <ChevronRight
                size={16}
                className={cn(
                  "mt-0.5 shrink-0 text-zinc-400",
                  loadingSessionId === session.session_id && "animate-pulse"
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-black/6 px-5 py-4 text-xs text-zinc-500 dark:border-white/6 dark:text-zinc-400">
        <div className="truncate">{workspace || "..."}</div>
        <div className="mt-1 font-mono">{model || "..."}</div>
      </div>
    </aside>
  );
}
