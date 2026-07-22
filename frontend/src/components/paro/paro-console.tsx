"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Sparkles,
  Terminal,
} from "lucide-react";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import { Composer } from "@/components/paro/composer";
import { SessionSidebar } from "@/components/paro/session-sidebar";
import { TurnView } from "@/components/paro/turn-view";
import { useParoBackendBootstrap } from "@/hooks/use-paro-backend-bootstrap";
import { useParoChatStream } from "@/hooks/use-paro-chat-stream";
import { useParoSessions } from "@/hooks/use-paro-sessions";
import { useParoSkills } from "@/hooks/use-paro-skills";
import { useParoUploads } from "@/hooks/use-paro-uploads";
import type {
  LlmAgentItem,
  SessionItem,
  Turn,
  UploadedFileItem,
} from "@/types/paro";

function normalizeApiBase(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/$/, "");
}

type ParoConsoleProps = {
  variant?: "default" | "mobile";
};

export function ParoConsole({ variant = "default" }: ParoConsoleProps) {
  const isMobileApp = variant === "mobile";
  const t = useTranslations("paro");
  const apiBase = useMemo(
    () =>
      normalizeApiBase(process.env.NEXT_PUBLIC_PARO_API_BASE) ||
      normalizeApiBase(process.env.NEXT_PUBLIC_PARO_PYTHON_API_BASE) ||
      "http://127.0.0.1:8765",
    []
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [thinkingOpenByTurn, setThinkingOpenByTurn] = useState<Record<string, boolean>>({});
  const [sessionBusy, setSessionBusy] = useState(false);
  const [llmAgents, setLlmAgents] = useState<LlmAgentItem[]>([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>("primary");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const liveLogRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeTurnIdRef = useRef<string | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const examples = useMemo(
    () => [t("example_1"), t("example_2"), t("example_3")],
    [t]
  );
  const {
    applyLoadedSkills,
    expandedSkillGroup,
    refreshSkills,
    selectedSkills,
    setExpandedSkillGroup,
    setSelectedSkills,
    setSkills,
    skillGroups,
    skills,
    toggleSkill,
  } = useParoSkills({ apiBase });
  const latestUserPrompt = turns[turns.length - 1]?.userText;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  const {
    abortSessionSync,
    clearLoadingSession,
    loadingSessionId,
    loadSession,
    refreshSessions,
  } = useParoSessions({
    apiBase,
    sessionId,
    pending,
    sessionBusy,
    defaultErrorMessage: t("error_default"),
    activeTurnIdRef,
    interruptCurrentRun,
    setError,
    setModel,
    setSelectedAgentKey,
    setSessionBusy,
    setSessionId,
    setSessions,
    setThinkingOpenByTurn,
    setTurns,
    setUploadedFiles,
    setWorkspace,
  });

  const {
    deletingUploadId,
    dragActive,
    fileInputRef,
    handleComposerDragEnter,
    handleComposerDragLeave,
    handleComposerDragOver,
    handleComposerDrop,
    onFilesSelected,
    removeUploadedFile,
    uploadingFiles,
  } = useParoUploads({
    apiBase,
    sessionId,
    pending,
    uploadErrorMessage: t("upload_error"),
    refreshSessions,
    setError,
    setSessionId,
    setUploadedFiles,
  });

  const { sendPrompt, stopCurrentTurn } = useParoChatStream({
    apiBase,
    input,
    pending,
    selectedAgentKey,
    selectedSkills,
    sessionBusy,
    sessionId,
    stopRequested,
    uploadingFiles,
    activeTurnIdRef,
    chatAbortControllerRef,
    loadSession,
    refreshSessions,
    refreshSkills,
    setError,
    setHealth,
    setInput,
    setModel,
    setPending,
    setSelectedAgentKey,
    setSessionBusy,
    setSessionId,
    setStopRequested,
    setTurns,
    setWorkspace,
    labels: {
      errorDefault: t("error_default"),
      runtimeComplete: t("runtime_complete"),
      runtimeCompact: t("runtime_compact"),
      runtimeDone: t("runtime_done"),
      runtimeError: t("runtime_error"),
      runtimeStatus: t("runtime_status"),
      runtimeStopped: t("runtime_stopped"),
      runtimeStopping: t("runtime_stopping"),
      runtimeStopIdle: t("runtime_stop_idle"),
      runtimeTool: t("runtime_tool"),
    },
  });

  useParoBackendBootstrap({
    activeTurnIdRef,
    apiBase,
    clearLoadingSession,
    interruptCurrentRun,
    applyLoadedSkills,
    setError,
    setHealth,
    setLlmAgents,
    setModel,
    setSelectedAgentKey,
    setSessionId,
    setSessions,
    setThinkingOpenByTurn,
    setTurns,
    setUploadedFiles,
    setWorkspace,
  });

  function scrollLiveLogsToBottom() {
    Object.values(liveLogRefs.current).forEach((container) => {
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    });
  }

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
    scrollLiveLogsToBottom();
    const rafId = requestAnimationFrame(scrollLiveLogsToBottom);
    const timer = window.setTimeout(scrollLiveLogsToBottom, 140);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [turns]);

  function interruptCurrentRun() {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    setPending(false);
    setStopRequested(false);
    activeTurnIdRef.current = null;
  }

  function resetSession() {
    interruptCurrentRun();
    abortSessionSync();
    setTurns([]);
    setUploadedFiles([]);
    setSessionId(null);
    setError(null);
    setStopRequested(false);
    setSessionBusy(false);
    setThinkingOpenByTurn({});
    activeTurnIdRef.current = null;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadingFiles) return;
    void sendPrompt(input);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (uploadingFiles) return;
    void sendPrompt(input);
  }

  return (
    <div
      className={cn(
        "flex overflow-hidden text-[var(--color-text)]",
        isMobileApp
          ? "-mx-4 -my-8 h-[calc(100vh-3.5rem)] bg-[#f1f1ee] dark:bg-[#0b0c0f] sm:mx-auto sm:my-0 sm:h-[calc(100vh-5rem)] sm:max-w-[430px] sm:rounded-[28px] sm:border sm:border-black/10 sm:shadow-[0_22px_60px_-40px_rgba(0,0,0,0.55)] sm:dark:border-white/10"
          : "-mx-4 -my-8 h-[calc(100vh-3.5rem)] bg-[#f5f5f2] dark:bg-[#0b0c0f] sm:-mx-6 lg:-mx-8"
      )}
    >
      {!isMobileApp && (
        <SessionSidebar
          latestUserPrompt={latestUserPrompt}
          loadingSessionId={loadingSessionId}
          model={model}
          sessions={sessions}
          workspace={workspace}
          onLoadSession={(targetSessionId) => void loadSession(targetSessionId)}
          onResetSession={resetSession}
          labels={{
            currentSession: t("current_session"),
            newSession: t("new_session"),
            sidebarSessions: t("sidebar_sessions"),
            sessionEmpty: t("session_empty"),
          }}
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "absolute inset-x-0 top-0 z-10 border-b border-black/6 bg-white/76 backdrop-blur dark:border-white/6 dark:bg-[#0f1013]/80",
            isMobileApp ? "px-3 py-2.5" : "px-4 py-3 sm:px-6 lg:px-8"
          )}
        >
          <div
            className={cn(
              "mx-auto flex items-center justify-between gap-4",
              isMobileApp ? "max-w-[430px]" : "max-w-7xl"
            )}
          >
            <div className="min-w-0">
              {!isMobileApp && (
                <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                  <Sparkles size={14} />
                  {t("badge")}
                  <Image
                    src={withBasePath("/brand/aparo.png")}
                    alt="Parrot"
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 rounded-full object-cover"
                  />
                </div>
              )}
              {sessionId && !isMobileApp && (
                <div className="mt-1">
                  <span className="hidden rounded-full border border-black/8 px-3 py-1 font-mono text-[11px] text-zinc-500 dark:border-white/10 dark:text-zinc-400 md:inline-flex">
                    {sessionId}
                  </span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {llmAgents.length > 1 && (
                <div className="hidden items-center gap-2 md:flex">
                  <span className="text-[11px] text-zinc-500">{t("agent_label")}</span>
                  <select
                    value={selectedAgentKey}
                    onChange={(event) => setSelectedAgentKey(event.target.value)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-zinc-700 outline-none transition-colors hover:bg-zinc-50 focus:ring-2 focus:ring-zinc-300 dark:border-white/12 dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/15"
                    disabled={pending}
                  >
                    {llmAgents.map((agent) => (
                      <option key={agent.key} value={agent.key}>
                        {agent.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full text-xs font-medium",
                  isMobileApp ? "px-2.5 py-1" : "px-3 py-1",
                  health === "online" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
                  health === "offline" && "bg-rose-500/12 text-rose-700 dark:text-rose-300",
                  health === "checking" && "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                )}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
                {t(`health_${health}`)}
              </span>
            </div>
          </div>
        </div>

        <div
          ref={transcriptRef}
          className={cn(
            "h-full overflow-y-auto",
            isMobileApp ? "px-3 pb-52 pt-18" : "px-4 pb-84 pt-24 sm:px-6 lg:px-8"
          )}
        >
          <div className={cn("mx-auto flex min-h-full flex-col", isMobileApp ? "max-w-[430px]" : "max-w-7xl")}>
            {turns.length === 0 ? (
              <div
                className={cn(
                  "m-auto w-full border border-black/8 bg-white/88 text-center shadow-[0_20px_70px_-48px_rgba(0,0,0,0.28)] dark:border-white/8 dark:bg-[#111216]",
                  isMobileApp ? "max-w-full rounded-3xl px-5 py-7" : "max-w-4xl rounded-[32px] px-8 py-10"
                )}
              >
                <div
                  className={cn(
                    "mx-auto flex items-center justify-center rounded-2xl border border-black/8 bg-zinc-50 dark:border-white/8 dark:bg-white/5",
                    isMobileApp ? "h-12 w-12" : "h-14 w-14"
                  )}
                >
                  <Terminal size={isMobileApp ? 22 : 28} />
                </div>
                <h2
                  className={cn(
                    "flex items-center justify-center gap-2 font-semibold tracking-[-0.04em]",
                    isMobileApp ? "mt-4 text-xl" : "mt-5 text-2xl"
                  )}
                >
                  <Image
                    src={withBasePath("/brand/aparo.png")}
                    alt={t("paro")}
                    width={22}
                    height={22}
                    className="h-[1.1em] w-[1.1em] rounded-full object-cover"
                  />
                  {t("empty_title")}
                </h2>
                <p
                  className={cn(
                    "mx-auto text-xs leading-6 text-zinc-600 dark:text-zinc-300",
                    isMobileApp ? "mt-2 max-w-full" : "mt-3 max-w-2xl"
                  )}
                >
                  {t("empty_body")}
                </p>
                <div className={cn("flex flex-wrap justify-center gap-2", isMobileApp ? "mt-5" : "mt-7")}>
                  {examples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => void sendPrompt(example)}
                      className="rounded-full border border-black/8 bg-white px-4 py-2 text-xs transition-colors hover:bg-zinc-50 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={cn(isMobileApp ? "space-y-4" : "space-y-6")}>
                {turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    isMobileApp={isMobileApp}
                    thinkingOpen={thinkingOpenByTurn[turn.id] ?? false}
                    turn={turn}
                    onToggleThinking={(turnId) => {
                      setThinkingOpenByTurn((prev) => {
                        const currentOpen = prev[turnId] ?? false;
                        return { ...prev, [turnId]: !currentOpen };
                      });
                    }}
                    setLiveLogRef={(turnId, node) => {
                      liveLogRefs.current[turnId] = node;
                    }}
                    labels={{
                      currentSkillLabel: t("current_skill_label"),
                      paro: t("paro"),
                      stopping: t("stopping"),
                      thinkingLabel: t("thinking_label"),
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#f5f5f2] via-[#f5f5f2]/92 to-transparent dark:from-[#0b0c0f] dark:via-[#0b0c0f]/92",
            isMobileApp ? "h-36" : "h-48"
          )}
        />

        <Composer
          deletingUploadId={deletingUploadId}
          dragActive={dragActive}
          error={error}
          expandedSkillGroup={expandedSkillGroup}
          fileInputRef={fileInputRef}
          input={input}
          isMobileApp={isMobileApp}
          pending={pending}
          selectedSkills={selectedSkills}
          sessionBusy={sessionBusy}
          sessionId={sessionId}
          skillGroups={skillGroups}
          stopRequested={stopRequested}
          uploadedFiles={uploadedFiles}
          uploadingFiles={uploadingFiles}
          onComposerDragEnter={handleComposerDragEnter}
          onComposerDragLeave={handleComposerDragLeave}
          onComposerDragOver={handleComposerDragOver}
          onComposerDrop={handleComposerDrop}
          onFilesSelected={onFilesSelected}
          onInputChange={setInput}
          onInputKeyDown={onInputKeyDown}
          onRemoveUploadedFile={(uploadId) => void removeUploadedFile(uploadId)}
          onSkillGroupToggle={(group) =>
            setExpandedSkillGroup((current) => (current === group ? null : group))
          }
          onStopCurrentTurn={() => void stopCurrentTurn()}
          onSubmit={onSubmit}
          onToggleSkill={toggleSkill}
          labels={{
            placeholder: t("placeholder"),
            skillsBuiltin: t("skills_builtin"),
            skillsExternal: t("skills_external"),
            skillsGroupEmpty: t("skills_group_empty"),
            skillsMaas: t("skills_maas"),
            stop: t("stop"),
            uploadsAdd: t("uploads_add"),
            uploadsRemove: t("uploads_remove"),
            uploadsUploading: t("uploads_uploading"),
          }}
        />
      </div>
    </div>
  );
}
