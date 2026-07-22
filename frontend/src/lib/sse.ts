export type StreamEvent = {
  event: string;
  session_id?: string;
  workspace?: string;
  model?: string;
  agent_key?: string;
  message?: string;
  text?: string;
  content?: string;
  stage?: string;
  tool?: string;
  summary?: string;
  output?: string;
  duration_ms?: number;
  transcript_path?: string;
};

export function parseStreamEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const frames = buffer.split(/\n\n/);
  const rest = frames.pop() || "";

  for (const frame of frames) {
    const data = frame
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) continue;
    events.push(JSON.parse(data) as StreamEvent);
  }

  return { events, rest };
}

export function parseFinalStreamEvents(buffer: string): StreamEvent[] {
  const trimmed = buffer.trim();
  if (!trimmed) return [];
  return parseStreamEvents(`${trimmed}\n\n`).events;
}
