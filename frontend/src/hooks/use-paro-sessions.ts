"use client";

import { MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { getSessionDetail, listSessions } from "@/lib/paro-api";
import type { SessionDetail, SessionItem, Turn, UploadedFileItem } from "@/types/paro";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTurnStatus(status?: string): Turn["status"] {
  if (status === "streaming" || status === "running") return "streaming";
  if (status === "stopping" || status === "stopped" || status === "error") return status;
  return "done";
}

type UseParoSessionsOptions = {
  apiBase: string;
  sessionId: string | null;
  pending: boolean;
  sessionBusy: boolean;
  defaultErrorMessage: string;
  activeTurnIdRef: MutableRefObject<string | null>;
  interruptCurrentRun: () => void;
  setError: (value: string | null) => void;
  setModel: (value: string) => void;
  setSelectedAgentKey: (value: string) => void;
  setSessionBusy: (value: boolean) => void;
  setSessionId: (value: string | null) => void;
  setSessions: (value: SessionItem[]) => void;
  setThinkingOpenByTurn: (value: Record<string, boolean>) => void;
  setTurns: (value: Turn[] | ((previous: Turn[]) => Turn[])) => void;
  setUploadedFiles: (value: UploadedFileItem[] | ((previous: UploadedFileItem[]) => UploadedFileItem[])) => void;
  setWorkspace: (value: string) => void;
};

export function useParoSessions({
  apiBase,
  sessionId,
  pending,
  sessionBusy,
  defaultErrorMessage,
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
}: UseParoSessionsOptions) {
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const sessionSyncAbortControllerRef = useRef<AbortController | null>(null);

  const abortSessionSync = useCallback(() => {
    sessionSyncAbortControllerRef.current?.abort();
    sessionSyncAbortControllerRef.current = null;
  }, []);

  const clearLoadingSession = useCallback(() => {
    setLoadingSessionId(null);
  }, []);

  const refreshSessions = useCallback(async (signal?: AbortSignal, baseOverride?: string) => {
    try {
      const base = baseOverride || apiBase;
      setSessions(await listSessions(base, signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [apiBase, setSessions]);

  const applySessionDetail = useCallback((data: SessionDetail) => {
    const hydratedTurns = (data.turns || []).map((turn) => ({
      id: uid("turn"),
      userText: turn.user_text,
      assistantText: turn.assistant_text,
      selectedSkills: turn.selected_skills || [],
      logs: (turn.logs || []).map((log) => ({
        id: uid("log"),
        tone: log.tone || "info",
        kind: log.kind,
        title: log.title || "",
        body: log.body || "",
        durationMs: log.duration_ms,
      })),
      mediaOutput: turn.media_output || null,
      status: normalizeTurnStatus(turn.status),
    }));
    const running = hydratedTurns.some((turn) => turn.status === "streaming");

    setSessionId(data.session_id);
    if (data.workspace) setWorkspace(data.workspace);
    if (data.model) setModel(data.model);
    if (data.agent_key) setSelectedAgentKey(data.agent_key);
    setUploadedFiles(data.uploads || []);
    setTurns(hydratedTurns);
    setSessionBusy(running);
    setThinkingOpenByTurn({});
    activeTurnIdRef.current = null;
  }, [
    activeTurnIdRef,
    setModel,
    setSelectedAgentKey,
    setSessionBusy,
    setSessionId,
    setThinkingOpenByTurn,
    setTurns,
    setUploadedFiles,
    setWorkspace,
  ]);

  const loadSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) return;
    if (pending) interruptCurrentRun();
    abortSessionSync();
    setLoadingSessionId(targetSessionId);
    setError(null);
    try {
      applySessionDetail(await getSessionDetail(apiBase, targetSessionId));
    } catch (err) {
      const message = err instanceof Error ? err.message : defaultErrorMessage;
      setError(message);
    } finally {
      setLoadingSessionId(null);
    }
  }, [
    abortSessionSync,
    apiBase,
    applySessionDetail,
    defaultErrorMessage,
    interruptCurrentRun,
    pending,
    setError,
  ]);

  useEffect(() => {
    if (!sessionId || pending || loadingSessionId || !sessionBusy) return;

    const controller = new AbortController();
    abortSessionSync();
    sessionSyncAbortControllerRef.current = controller;

    const syncSession = async () => {
      try {
        const data = await getSessionDetail(apiBase, sessionId, controller.signal);
        if (controller.signal.aborted || data.session_id !== sessionId) return;
        applySessionDetail(data);
        void refreshSessions(undefined, apiBase);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void syncSession();
    const intervalId = window.setInterval(() => {
      void syncSession();
    }, 1500);

    return () => {
      controller.abort();
      clearInterval(intervalId);
      if (sessionSyncAbortControllerRef.current === controller) {
        sessionSyncAbortControllerRef.current = null;
      }
    };
  }, [
    abortSessionSync,
    apiBase,
    applySessionDetail,
    loadingSessionId,
    pending,
    refreshSessions,
    sessionBusy,
    sessionId,
  ]);

  return {
    abortSessionSync,
    clearLoadingSession,
    loadingSessionId,
    loadSession,
    refreshSessions,
  };
}
