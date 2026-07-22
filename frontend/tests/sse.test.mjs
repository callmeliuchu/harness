import assert from "node:assert/strict";
import test from "node:test";

import { parseFinalStreamEvents, parseStreamEvents } from "../src/lib/sse.ts";

test("parseStreamEvents keeps incomplete frames as rest", () => {
  const chunk = [
    "event: session",
    'data: {"event":"session","session_id":"abc"}',
    "",
    "event: status",
    'data: {"event":"status"',
  ].join("\n");

  const parsed = parseStreamEvents(chunk);

  assert.deepEqual(parsed.events, [{ event: "session", session_id: "abc" }]);
  assert.equal(parsed.rest, 'event: status\ndata: {"event":"status"');
});

test("parseStreamEvents joins multi-line data payloads", () => {
  const chunk = [
    "event: assistant",
    'data: {"event":"assistant",',
    'data: "message":"hello"}',
    "",
    "",
  ].join("\n");

  assert.deepEqual(parseStreamEvents(chunk).events, [
    { event: "assistant", message: "hello" },
  ]);
});

test("parseFinalStreamEvents flushes a complete trailing frame", () => {
  const buffer = 'event: done\ndata: {"event":"done","message":"Turn completed."}';

  assert.deepEqual(parseFinalStreamEvents(buffer), [
    { event: "done", message: "Turn completed." },
  ]);
});
