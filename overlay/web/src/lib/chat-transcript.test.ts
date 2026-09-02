import { describe, expect, it } from "vitest";

import type { SessionMessage } from "@/lib/api";
import {
  groupTranscript,
  systemNoteOf,
  toolCallPreview,
} from "./chat-transcript";

function assistant(
  content: string | null,
  calls: Array<[string, string, string]> = [],
): SessionMessage {
  return {
    content,
    role: "assistant",
    tool_calls: calls.length
      ? calls.map(([id, name, args]) => ({
          function: { arguments: args, name },
          id,
        }))
      : undefined,
  };
}

function toolResult(id: string, name: string, content: string): SessionMessage {
  return { content, role: "tool", tool_call_id: id, tool_name: name };
}

describe("toolCallPreview", () => {
  it("shows the first meaningful string argument", () => {
    expect(toolCallPreview('{"command":"ls -la ~/.hermes/"}')).toBe(
      "ls -la ~/.hermes/",
    );
  });

  it("flattens newlines out of a multi-line argument", () => {
    expect(toolCallPreview('{"command":"printf a\\nb"}')).toBe("printf a b");
  });

  it("truncates a long argument", () => {
    const long = "x".repeat(200);
    const preview = toolCallPreview(`{"command":"${long}"}`, 20);
    expect(preview).toHaveLength(21);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("falls back to the raw text when the args are not JSON", () => {
    expect(toolCallPreview("not json at all")).toBe("not json at all");
  });

  it("is empty for an empty argument object", () => {
    expect(toolCallPreview("{}")).toBe("");
  });
});

describe("groupTranscript", () => {
  it("keeps ordinary messages as messages", () => {
    const items = groupTranscript([
      { content: "chào em", role: "user" },
      assistant("chào anh"),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("collapses a run of calls and their results into one group", () => {
    const items = groupTranscript([
      assistant("Để em xem nào.", [["a", "terminal", '{"command":"ls"}']]),
      toolResult("a", "terminal", "file.txt"),
      assistant(null, [["b", "terminal", '{"command":"pwd"}']]),
      toolResult("b", "terminal", "/home"),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["message", "tools"]);
    const group = items[1] as Extract<(typeof items)[number], { kind: "tools" }>;
    expect(group.calls).toHaveLength(2);
    expect(group.calls[0].result).toBe("file.txt");
    expect(group.calls[1].name).toBe("terminal");
    expect(group.calls.every((call) => call.done)).toBe(true);
  });

  it("marks a call still waiting for its result", () => {
    const items = groupTranscript([
      assistant(null, [["a", "web_search", '{"query":"VN-Index"}']]),
    ]);
    const group = items[0] as Extract<(typeof items)[number], { kind: "tools" }>;
    expect(group.calls[0].done).toBe(false);
    expect(group.calls[0].result).toBeUndefined();
  });

  it("starts a new group after the assistant speaks again", () => {
    const items = groupTranscript([
      assistant(null, [["a", "terminal", "{}"]]),
      toolResult("a", "terminal", "ok"),
      assistant("xong rồi anh"),
      assistant(null, [["b", "terminal", "{}"]]),
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "tools",
      "message",
      "tools",
    ]);
  });

  it("matches a result to its own call, not just the first open one", () => {
    const items = groupTranscript([
      assistant(null, [
        ["a", "one", "{}"],
        ["b", "two", "{}"],
      ]),
      toolResult("b", "two", "kết quả B"),
    ]);
    const group = items[0] as Extract<(typeof items)[number], { kind: "tools" }>;
    expect(group.calls[0].done).toBe(false);
    expect(group.calls[1].result).toBe("kết quả B");
  });

  it("keeps an orphaned tool result rather than dropping it", () => {
    const items = groupTranscript([toolResult("z", "terminal", "mồ côi")]);
    expect(items).toHaveLength(1);
    const group = items[0] as Extract<(typeof items)[number], { kind: "tools" }>;
    expect(group.calls[0].result).toBe("mồ côi");
  });

  it("skips empty system rows and contentless assistant rows", () => {
    const items = groupTranscript([
      { content: null, role: "system" },
      assistant(null),
      { content: "còn đây", role: "user" },
    ]);
    expect(items).toHaveLength(1);
  });
});

describe("systemNoteOf", () => {
  it("turns the model-switch banner into one Vietnamese line", () => {
    const note = systemNoteOf(
      "[System: The active model for this chat has changed to z-ai/glm-5.3-flash " +
        "via provider openrouter. From this point forward, use this runtime " +
        "metadata when answering questions about what model/provider is active.]",
    );
    expect(note).toEqual({
      kind: "model",
      text: "Phiên này đã chuyển sang mô hình z-ai/glm-5.3-flash (qua openrouter).",
    });
  });

  it("handles the banner without a provider", () => {
    const note = systemNoteOf(
      "[System: The active model for this chat has changed to gpt-5. Use it.]",
    );
    expect(note?.text).toBe("Phiên này đã chuyển sang mô hình gpt-5.");
  });

  it("leaves ordinary messages alone", () => {
    expect(systemNoteOf("kể em nghe một câu chuyện")).toBeNull();
    expect(systemNoteOf("[System: something else entirely]")).toBeNull();
  });
});

describe("isInternalNotification", () => {
  it("trusts Hermes's own display_kind flag", async () => {
    const { isInternalNotification } = await import("./chat-transcript");
    expect(
      isInternalNotification({
        content: "bất kỳ nội dung gì",
        display_kind: "internal_notification",
        role: "user",
      }),
    ).toBe(true);
  });

  it("recognises a delegation report written before the flag existed", async () => {
    const { isInternalNotification } = await import("./chat-transcript");
    expect(
      isInternalNotification({
        content:
          "[ASYNC DELEGATION BATCH COMPLETE — deleg_d261919e] A background fan-out…",
        role: "user",
      }),
    ).toBe(true);
  });

  it("leaves a real user message alone", async () => {
    const { isInternalNotification } = await import("./chat-transcript");
    expect(
      isInternalNotification({ content: "chào em", role: "user" }),
    ).toBe(false);
    // Only user-role rows carry this; an assistant reply about delegation is
    // still an assistant reply.
    expect(
      isInternalNotification({
        content: "[ASYNC DELEGATION BATCH COMPLETE]",
        role: "assistant",
      }),
    ).toBe(false);
  });
});

describe("internalNotificationSummaryVi", () => {
  it("reads the counts out of the report Hermes injects", async () => {
    const { internalNotificationSummaryVi } = await import("./chat-transcript");
    const summary = internalNotificationSummaryVi(
      "[ASYNC DELEGATION BATCH COMPLETE — deleg_d261919e] A background fan-out of 3 subagent(s) you dispatched earlier has finished.\nTotal duration: 28.36s\n✓ TASK 1/3",
    );
    expect(summary).toContain("3 agent phụ");
    expect(summary).toContain("28 giây");
  });

  it("counts failed tasks so a bad batch is not summarised as fine", async () => {
    const { internalNotificationSummaryVi } = await import("./chat-transcript");
    const summary = internalNotificationSummaryVi(
      "fan-out of 2 subagent(s)\n✗ TASK 1/2: hỏng\n✓ TASK 2/2: ok",
    );
    expect(summary).toContain("1 tác vụ hỏng");
  });

  it("still says something when the shape is unfamiliar", async () => {
    const { internalNotificationSummaryVi } = await import("./chat-transcript");
    expect(internalNotificationSummaryVi("gì đó lạ")).toContain("chạy nền");
  });
});
