"use client";

import { MutableRefObject, useEffect, useRef } from "react";
import { loadBackendSnapshot } from "@/lib/paro-api";
import type {
  LlmAgentItem,
  SessionItem,
  SkillItem,
  Turn,
  UploadedFileItem,
} from "@/types/paro";

type UseParoBackendBootstrapOptions = {
  activeTurnIdRef: MutableRefObject<string | null>;
  apiBase: string;
  clearLoadingSession: () => void;
  interruptCurrentRun: () => void;
  applyLoadedSkills: (skills: SkillItem[]) => void;
  setError: (value: string | null) => void;
  setHealth: (value: "checking" | "online" | "offline") => void;
  setLlmAgents: (value: LlmAgentItem[]) => void;
  setModel: (value: string) => void;
  setSelectedAgentKey: (value: string) => void;
  setSessionId: (value: string | null) => void;
  setSessions: (value: SessionItem[]) => void;
  setThinkingOpenByTurn: (value: Record<string, boolean>) => void;
  setTurns: (value: Turn[]) => void;
  setUploadedFiles: (value: UploadedFileItem[]) => void;
  setWorkspace: (value: string) => void;
};

export function useParoBackendBootstrap({
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
}: UseParoBackendBootstrapOptions) {
  const didInitializeRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    if (didInitializeRef.current) {
      interruptCurrentRun();
      clearLoadingSession();
      activeTurnIdRef.current = null;
    } else {
      didInitializeRef.current = true;
    }

    setHealth("checking");
    setError(null);

    const bootstrap = async () => {
      try {
        const snapshot = await loadBackendSnapshot(apiBase, controller.signal);
        if (controller.signal.aborted) return;

        const agents = Array.isArray(snapshot.healthData.agents)
          ? (snapshot.healthData.agents as LlmAgentItem[])
          : [];
        const defaultAgent = String(snapshot.healthData.default_agent || "").trim();

        setHealth("online");
        setError(null);
        setWorkspace(snapshot.healthData.workspace || "");
        setModel(snapshot.healthData.model || "");
        setSessions(snapshot.sessionsData.sessions || []);
        applyLoadedSkills(snapshot.skillsData.skills || []);
        setLlmAgents(agents);
        setSelectedAgentKey(defaultAgent || agents[0]?.key || "primary");
        setSessionId(null);
        setTurns([]);
        setUploadedFiles([]);
        setThinkingOpenByTurn({});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHealth("offline");
        setSessionId(null);
        setTurns([]);
        setUploadedFiles([]);
        setSessions([]);
        applyLoadedSkills([]);
        setLlmAgents([]);
        setSelectedAgentKey("primary");
        setThinkingOpenByTurn({});
      }
    };

    void bootstrap();

    return () => {
      controller.abort();
    };
  }, [apiBase]);
}
