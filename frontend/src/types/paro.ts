export type RunLog = {
  id: string;
  tone: "info" | "success" | "error";
  kind?: "status" | "tool_start" | "tool_result" | "compact" | "error" | "stopped" | "done";
  title: string;
  body: string;
  durationMs?: number;
};

export type Turn = {
  id: string;
  userText: string;
  assistantText: string;
  selectedSkills: string[];
  logs: RunLog[];
  mediaOutput: string | null;
  status: "streaming" | "stopping" | "stopped" | "done" | "error" | "running";
};

export type SessionItem = {
  session_id: string;
  preview: string;
};

export type UploadedFileItem = {
  id: string;
  original_name: string;
  stored_name: string;
  path: string;
  content_type: string;
  size: number;
  uploaded_at: number;
};

export type SessionDetail = {
  session_id: string;
  workspace?: string;
  model?: string;
  agent_key?: string;
  uploads?: UploadedFileItem[];
  turns: Array<{
    user_text: string;
    assistant_text: string;
    selected_skills?: string[];
    media_output?: string | null;
    logs?: Array<{
      tone?: "info" | "success" | "error";
      kind?: "status" | "tool_start" | "tool_result" | "compact" | "error" | "stopped" | "done";
      title?: string;
      body?: string;
      duration_ms?: number;
    }>;
    status?: "done" | "error" | "streaming" | "running";
  }>;
};

export type SkillItem = {
  name: string;
  description: string;
  category?: "builtin" | "maas" | "external";
  source?: string;
};

export type SkillGroupKey = "builtin" | "maas" | "external";

export type SkillGroups = Record<SkillGroupKey, SkillItem[]>;

export type LlmAgentItem = {
  key: string;
  display_name: string;
  provider: string;
  model: string;
  is_default?: boolean;
};
