import type { LlmAgentItem, SessionDetail, SessionItem, SkillItem, UploadedFileItem } from "@/types/paro";

export type HealthData = {
  workspace?: string;
  model?: string;
  default_agent?: string;
  agents?: LlmAgentItem[];
};

export type BackendSnapshot = {
  healthData: HealthData;
  sessionsData: { sessions?: SessionItem[] };
  skillsData: { skills?: SkillItem[] };
};

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = process.env.NEXT_PUBLIC_PARO_API_TOKEN?.trim();
  if (!token) return fetch(input, init);

  const headers = new Headers(init.headers);
  if (!headers.has("Authorization") && !headers.has("X-Paro-Api-Token")) {
    headers.set("X-Paro-Api-Token", token);
  }
  return fetch(input, { ...init, headers });
}

export async function responseError(response: Response): Promise<Error> {
  const detail = await response.text();
  return new Error(detail || `HTTP ${response.status}`);
}

export async function listSessions(apiBase: string, signal?: AbortSignal): Promise<SessionItem[]> {
  const response = await apiFetch(`${apiBase}/api/sessions`, signal ? { signal } : undefined);
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as Array<{ id: string; preview?: string }> | { sessions?: SessionItem[] };
  if (Array.isArray(data)) return data.map((item) => ({ session_id: item.id, preview: item.preview || "" }));
  return data.sessions || [];
}

export async function listSkills(apiBase: string, signal?: AbortSignal): Promise<SkillItem[]> {
  void apiBase;
  void signal;
  return [];
}

export async function loadBackendSnapshot(apiBase: string, signal?: AbortSignal): Promise<BackendSnapshot> {
  const sessions = await listSessions(apiBase, signal);

  return {
    healthData: { model: "DeepSeek", default_agent: "primary", agents: [{ key: "primary", display_name: "PyCodex", provider: "OpenAI compatible", model: "DeepSeek", is_default: true }] },
    sessionsData: { sessions },
    skillsData: { skills: [] },
  };
}

export async function getSessionDetail(apiBase: string, sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
  const response = await apiFetch(`${apiBase}/api/sessions/${sessionId}`, signal ? { signal } : undefined);
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as { metadata?: { workspace?: string }; events?: Array<Record<string, any>> };
  const turns: SessionDetail["turns"] = [];
  let current: SessionDetail["turns"][number] | null = null;
  for (const event of data.events || []) {
    const item = event.item || {};
    if (event.type === "item" && item.role === "user") {
      current = { user_text: item.content || "", assistant_text: "", logs: [], status: "running" };
      turns.push(current);
    } else if (current && event.type === "item" && item.role === "assistant" && item.content) {
      current.assistant_text = item.content;
      current.status = "done";
    } else if (current && event.type === "agent_event" && event.event === "tool_call_started") {
      current.logs?.push({ tone: "info", kind: "tool_start", title: event.data?.name || "tool", body: JSON.stringify(event.data?.arguments || {}, null, 2) });
    } else if (current && event.type === "agent_event" && event.event === "tool_call_completed") {
      current.logs?.push({ tone: event.data?.ok ? "success" : "error", kind: "tool_result", title: event.data?.name || "tool", body: JSON.stringify(event.data?.result || {}, null, 2) });
    }
  }
  return { session_id: sessionId, workspace: data.metadata?.workspace, model: "DeepSeek", agent_key: "primary", uploads: [], turns };
}

export async function uploadParoFile(apiBase: string, sessionId: string, file: File): Promise<UploadedFileItem | null> {
  const response = await apiFetch(
    `${apiBase}/api/uploads?session_id=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    }
  );
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as { upload?: UploadedFileItem };
  return data.upload || null;
}

export async function deleteParoUpload(apiBase: string, sessionId: string, uploadId: string): Promise<UploadedFileItem[]> {
  const response = await apiFetch(
    `${apiBase}/api/uploads/${encodeURIComponent(uploadId)}?session_id=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as { uploads?: UploadedFileItem[] };
  return Array.isArray(data.uploads) ? data.uploads : [];
}

export function startChatStream(
  apiBase: string,
  payload: {
    message: string;
    session_id: string;
    selected_skills: string[];
    agent_key: string;
  },
  signal: AbortSignal
) {
  return startPyCodexStream(apiBase, payload, signal);
}

async function startPyCodexStream(apiBase: string, payload: { message: string; session_id: string }, signal: AbortSignal) {
  const existingSession = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.session_id) ? payload.session_id : undefined;
  const start = await apiFetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ message: payload.message, session_id: existingSession }),
  });
  if (!start.ok) return start;
  const started = (await start.json()) as { session_id: string };
  const source = await apiFetch(`${apiBase}/api/sessions/${started.session_id}/events?after=-1`, { signal });
  if (!source.ok || !source.body) return source;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "session", session_id: started.session_id, model: "DeepSeek", agent_key: "primary" })}\n\n`));
      const reader = source.body!.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\n\n/);
            buffer = frames.pop() || "";
            for (const frame of frames) {
              const data = frame.split(/\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
              if (!data) continue;
              const raw = JSON.parse(data) as Record<string, any>;
              const mapped = mapPyCodexEvent(raw);
              if (raw.event === "approval_requested") {
                void apiFetch(`${apiBase}/api/sessions/${started.session_id}/approvals/${raw.data.approval_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed: false }) });
              }
              if (mapped) controller.enqueue(encoder.encode(`data: ${JSON.stringify(mapped)}\n\n`));
              if (mapped?.event === "done" || mapped?.event === "error") { await reader.cancel(); controller.close(); return; }
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      };
      void pump();
    },
  });
  return new Response(readable, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function mapPyCodexEvent(raw: Record<string, any>): Record<string, any> | null {
  if (raw.type === "item" && raw.item?.role === "assistant" && raw.item?.content) return null;
  if (raw.type === "compaction") return { event: "compact", message: "Context compacted" };
  if (raw.type !== "agent_event") return null;
  const data = raw.data || {};
  if (raw.event === "model_text_delta") return { event: "assistant", text: data.text || "" };
  if (raw.event === "tool_call_started") return { event: "tool_start", tool: data.name, summary: JSON.stringify(data.arguments || {}) };
  if (raw.event === "tool_call_completed") return { event: "tool_result", tool: data.name, output: JSON.stringify(data.result || {}, null, 2) };
  if (raw.event === "tool_output") return { event: "status", message: data.text || "" };
  if (raw.event === "compaction_completed") return { event: "compact", message: "Context compacted" };
  if (raw.event === "turn_completed") return { event: "done", message: "Complete" };
  if (raw.event === "turn_failed") return { event: "error", message: data.error || "Agent failed" };
  if (raw.event === "approval_requested") return { event: "status", message: `${data.name || "Tool"} was denied because web approval is not enabled.` };
  if (raw.event === "model_request_started") return { event: "status", message: "Thinking…" };
  return null;
}

export async function cancelSession(apiBase: string, sessionId: string): Promise<{ status?: string }> {
  void apiBase;
  void sessionId;
  return { status: "idle" };
}
