"use client";

import { MutableRefObject, useCallback } from "react";
import { cancelSession, getSessionDetail, responseError, startChatStream } from "@/lib/paro-api";
import { toMediaOnlyOutput } from "@/lib/media-output";
import { parseFinalStreamEvents, parseStreamEvents, type StreamEvent } from "@/lib/sse";
import type { RunLog, Turn } from "@/types/paro";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type ChatLabels = {
  errorDefault: string;
  runtimeComplete: string;
  runtimeCompact: string;
  runtimeDone: string;
  runtimeError: string;
  runtimeStatus: string;
  runtimeStopped: string;
  runtimeStopping: string;
  runtimeStopIdle: string;
  runtimeTool: string;
};

type UseParoChatStreamOptions = {
  apiBase: string;
  input: string;
  pending: boolean;
  selectedAgentKey: string;
  selectedSkills: string[];
  sessionBusy: boolean;
  sessionId: string | null;
  stopRequested: boolean;
  uploadingFiles: boolean;
  activeTurnIdRef: MutableRefObject<string | null>;
  chatAbortControllerRef: MutableRefObject<AbortController | null>;
  loadSession: (targetSessionId: string) => Promise<void>;
  refreshSessions: () => void;
  refreshSkills: () => void;
  setError: (value: string | null) => void;
  setHealth: (value: "checking" | "online" | "offline") => void;
  setInput: (value: string) => void;
  setModel: (value: string) => void;
  setPending: (value: boolean) => void;
  setSelectedAgentKey: (value: string) => void;
  setSessionBusy: (value: boolean) => void;
  setSessionId: (value: string | null) => void;
  setStopRequested: (value: boolean) => void;
  setTurns: (value: Turn[] | ((previous: Turn[]) => Turn[])) => void;
  setWorkspace: (value: string) => void;
  labels: ChatLabels;
};

export function useParoChatStream({
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
  labels,
}: UseParoChatStreamOptions) {
  const updateActiveTurn = useCallback((updater: (turn: Turn) => Turn) => {
    const activeId = activeTurnIdRef.current;
    if (!activeId) return;
    setTurns((prev) =>
      prev.map((turn) => (turn.id === activeId ? updater(turn) : turn))
    );
  }, [activeTurnIdRef, setTurns]);

  const updateTurnById = useCallback((turnId: string, updater: (turn: Turn) => Turn) => {
    setTurns((prev) =>
      prev.map((turn) => (turn.id === turnId ? updater(turn) : turn))
    );
  }, [setTurns]);

  const appendLog = useCallback((log: Omit<RunLog, "id">) => {
    updateActiveTurn((turn) => ({
      ...turn,
      logs: [...turn.logs, { id: uid("log"), ...log }],
    }));
  }, [updateActiveTurn]);

  const appendAssistantText = useCallback((text: string) => {
    updateActiveTurn((turn) => ({
      ...turn,
      assistantText: `${turn.assistantText}${text}`,
    }));
  }, [updateActiveTurn]);

  const syncFinalTurnFromSession = useCallback(async (turnId: string, fallbackMediaOutput?: string | null) => {
    if (!sessionId) return;
    try {
      const data = await getSessionDetail(apiBase, sessionId);
      const lastTurn = data.turns?.[data.turns.length - 1];
      if (!lastTurn) return;

      updateTurnById(turnId, (turn) => ({
        ...turn,
        assistantText: turn.assistantText || lastTurn.assistant_text || "",
        selectedSkills: turn.selectedSkills.length > 0 ? turn.selectedSkills : lastTurn.selected_skills || [],
        mediaOutput: turn.mediaOutput || lastTurn.media_output || fallbackMediaOutput || null,
        status: "done",
      }));
    } catch {
      // Ignore sync failures; the streamed view remains available.
    }
  }, [apiBase, sessionId, updateTurnById]);

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    if (event.event === "session") {
      if (event.session_id) setSessionId(event.session_id);
      if (event.workspace) setWorkspace(event.workspace);
      if (event.model) setModel(event.model);
      if (event.agent_key) setSelectedAgentKey(event.agent_key);
      return;
    }

    if (event.event === "status") {
      appendLog({
        tone: "info",
        kind: "status",
        title: labels.runtimeStatus,
        body: event.message || event.stage || "",
      });
      return;
    }

    if ((event.event === "assistant" || event.event === "assistant_text") && (event.message || event.text || event.content)) {
      appendAssistantText(String(event.message || event.text || event.content || ""));
      return;
    }

    if (event.event === "tool_start") {
      appendLog({
        tone: "info",
        kind: "tool_start",
        title: event.tool || labels.runtimeTool,
        body: event.summary || "",
      });
      return;
    }

    if (event.event === "tool_result") {
      const output = event.output || "";
      updateActiveTurn((turn) => {
        const mediaOnlyOutput = toMediaOnlyOutput(output);

        return {
          ...turn,
          logs: [
            ...turn.logs,
            {
              id: uid("log"),
              tone: "success",
              kind: "tool_result",
              title: `${event.tool || labels.runtimeTool} ${labels.runtimeDone}`,
              body: output,
              durationMs: event.duration_ms,
            },
          ],
          mediaOutput: mediaOnlyOutput || turn.mediaOutput,
        };
      });
      return;
    }

    if (event.event === "compact") {
      appendLog({
        tone: "info",
        kind: "compact",
        title: labels.runtimeCompact,
        body: `${event.message || ""}\n${event.transcript_path || ""}`.trim(),
      });
      return;
    }

    if (event.event === "error") {
      const message = event.message || labels.errorDefault;
      setError(message);
      setHealth("offline");
      setPending(false);
      setSessionBusy(false);
      setStopRequested(false);
      updateActiveTurn((turn) => ({
        ...turn,
        status: "error",
        logs: [
          ...turn.logs,
          { id: uid("log"), tone: "error", kind: "error", title: labels.runtimeError, body: message },
        ],
      }));
      activeTurnIdRef.current = null;
      return;
    }

    if (event.event === "stopped") {
      setPending(false);
      setSessionBusy(false);
      setStopRequested(false);
      updateActiveTurn((turn) => ({
        ...turn,
        status: "stopped",
        logs: [
          ...turn.logs,
          {
            id: uid("log"),
            tone: "info",
            kind: "stopped",
            title: labels.runtimeStopped,
            body: event.message || "",
          },
        ],
      }));
      activeTurnIdRef.current = null;
      void refreshSessions();
      void refreshSkills();
      return;
    }

    if (event.event === "done") {
      const completedTurnId = activeTurnIdRef.current;
      setPending(false);
      setSessionBusy(false);
      setStopRequested(false);
      updateActiveTurn((turn) => ({
        ...turn,
        status: "done",
        logs: [
          ...turn.logs,
          {
            id: uid("log"),
            tone: "success",
            kind: "done",
            title: labels.runtimeComplete,
            body: event.message || "",
          },
        ],
      }));
      activeTurnIdRef.current = null;
      void refreshSkills();
      if (completedTurnId) {
        void syncFinalTurnFromSession(completedTurnId);
      }
    }
  }, [
    activeTurnIdRef,
    appendAssistantText,
    appendLog,
    labels,
    refreshSessions,
    refreshSkills,
    setError,
    setHealth,
    setModel,
    setPending,
    setSelectedAgentKey,
    setSessionBusy,
    setSessionId,
    setStopRequested,
    setWorkspace,
    syncFinalTurnFromSession,
    updateActiveTurn,
  ]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const content = prompt.trim();
    if (!content || pending || uploadingFiles) return;
    if (sessionBusy) {
      setError("This session is busy.");
      return;
    }
    const targetSessionId = sessionId || `session-${Math.random().toString(36).slice(2, 10)}`;
    const turnSelectedSkills = [...selectedSkills];
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    const turnId = uid("turn");
    activeTurnIdRef.current = turnId;
    setPending(true);
    setSessionBusy(true);
    setStopRequested(false);
    setError(null);
    if (!sessionId) setSessionId(targetSessionId);
    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        userText: content,
        assistantText: "",
        selectedSkills: turnSelectedSkills,
        logs: [],
        mediaOutput: null,
        status: "streaming",
      },
    ]);
    setInput("");

    try {
      const response = await startChatStream(
        apiBase,
        {
          message: content,
          session_id: targetSessionId,
          selected_skills: turnSelectedSkills,
          agent_key: selectedAgentKey,
        },
        abortController.signal
      );

      if (!response.ok || !response.body) {
        const detail = !response.ok ? (await responseError(response)).message : "";
        if (response.status === 409) {
          setSessionBusy(true);
          setError(detail || "This session is busy.");
          await loadSession(targetSessionId);
          return;
        }
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parsed = parseStreamEvents(buffer);
        buffer = parsed.rest;

        for (const event of parsed.events) {
          handleStreamEvent(event);
        }

        if (done) {
          for (const event of parseFinalStreamEvents(buffer)) {
            handleStreamEvent(event);
          }
          break;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : labels.errorDefault;
      setError(message);
      if (!message.includes("This session is busy")) {
        setHealth("offline");
      }
      setSessionBusy(false);
      setStopRequested(false);
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                logs: [
                  ...turn.logs,
                  {
                    id: uid("log"),
                    tone: "error",
                    kind: "error",
                    title: labels.runtimeError,
                    body: message,
                  },
                ],
              }
            : turn
        )
      );
      activeTurnIdRef.current = null;
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      setPending(false);
      void refreshSessions();
    }
  }, [
    activeTurnIdRef,
    apiBase,
    chatAbortControllerRef,
    handleStreamEvent,
    labels.errorDefault,
    labels.runtimeError,
    loadSession,
    pending,
    refreshSessions,
    selectedAgentKey,
    selectedSkills,
    sessionBusy,
    sessionId,
    setError,
    setHealth,
    setInput,
    setPending,
    setSessionBusy,
    setSessionId,
    setStopRequested,
    setTurns,
    uploadingFiles,
  ]);

  const stopCurrentTurn = useCallback(async () => {
    if ((!pending && !sessionBusy) || !sessionId || stopRequested) return;
    setError(null);
    setStopRequested(true);
    updateActiveTurn((turn) => ({
      ...turn,
      status: "stopping",
      logs: [
        ...turn.logs,
        {
          id: uid("log"),
          tone: "info",
          kind: "status",
          title: labels.runtimeStatus,
          body: labels.runtimeStopping,
        },
      ],
    }));

    try {
      const data = await cancelSession(apiBase, sessionId);
      if (data.status !== "cancelling") {
        setStopRequested(false);
        updateActiveTurn((turn) => ({
          ...turn,
          status: "streaming",
          logs: [
            ...turn.logs,
            {
              id: uid("log"),
              tone: "info",
              kind: "status",
              title: labels.runtimeStatus,
              body: labels.runtimeStopIdle,
            },
          ],
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.errorDefault;
      setError(message);
      setStopRequested(false);
      updateActiveTurn((turn) => ({
        ...turn,
        status: "streaming",
        logs: [
          ...turn.logs,
          {
            id: uid("log"),
            tone: "error",
            kind: "error",
            title: labels.runtimeError,
            body: message,
          },
        ],
      }));
    }
  }, [
    apiBase,
    labels,
    pending,
    sessionBusy,
    sessionId,
    setError,
    setStopRequested,
    stopRequested,
    updateActiveTurn,
  ]);

  return {
    sendPrompt,
    stopCurrentTurn,
  };
}
