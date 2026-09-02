import { describe, expect, it } from "vitest";

import {
  EMPTY_LIVE_TURN,
  parseLiveTurnEvent,
  reduceLiveTurn,
  stallWarningVi,
  shouldClearLiveTurn,
  type LiveTurn,
} from "./chat-live-turn";

function feed(events: Array<[string, unknown?]>): LiveTurn {
  return events.reduce(
    (state, [type, payload]) => reduceLiveTurn(state, { payload, seq: null, sessionId: null, type }),
    EMPTY_LIVE_TURN,
  );
}

describe("parseLiveTurnEvent", () => {
  it("reads the gateway envelope", () => {
    const raw = JSON.stringify({
      method: "event",
      params: { payload: { text: "xin chào" }, type: "message.delta" },
    });
    expect(parseLiveTurnEvent(raw)).toEqual({
      payload: { text: "xin chào" },
      seq: null,
      sessionId: null,
      type: "message.delta",
    });
  });

  it("keeps the sequence number when the gateway stamped one", () => {
    const raw = JSON.stringify({
      method: "event",
      params: { payload: {}, seq: 42, type: "message.start" },
    });
    expect(parseLiveTurnEvent(raw)?.seq).toBe(42);
  });

  it("reads a bare replay event, the shape session.events.since returns", () => {
    const raw = JSON.stringify({
      payload: { text: "delta thô" },
      seq: 7,
      session_id: "20260831_025535",
      type: "message.delta",
    });
    expect(parseLiveTurnEvent(raw)).toEqual({
      payload: { text: "delta thô" },
      seq: 7,
      sessionId: "20260831_025535",
      type: "message.delta",
    });
  });

  it("ignores anything that is not an event", () => {
    expect(parseLiveTurnEvent("not json")).toBeNull();
    expect(parseLiveTurnEvent(JSON.stringify({ method: "rpc" }))).toBeNull();
    expect(
      parseLiveTurnEvent(JSON.stringify({ method: "event", params: {} })),
    ).toBeNull();
    expect(parseLiveTurnEvent(JSON.stringify({ seq: 3 }))).toBeNull();
  });
});

describe("reduceLiveTurn", () => {
  it("accumulates streamed text in order", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "Chào " }],
      ["message.delta", { text: "anh" }],
    ]);
    expect(state.text).toBe("Chào anh");
    expect(state.active).toBe(true);
    expect(state.done).toBe(false);
  });

  it("starts each turn from a clean slate", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "cũ" }],
      ["message.complete", { text: "cũ" }],
      ["message.start"],
    ]);
    expect(state.text).toBe("");
    expect(state.done).toBe(false);
  });

  it("tracks the running tool and clears it on completion", () => {
    const running = feed([
      ["message.start"],
      ["tool.start", { name: "image_generate" }],
    ]);
    expect(running.tool).toBe("image_generate");
    expect(
      reduceLiveTurn(running, {
        seq: null,
        sessionId: null,
        type: "tool.complete",
      }).tool,
    ).toBeNull();
  });

  it("flags reasoning without leaking the reasoning text", () => {
    const state = feed([
      ["message.start"],
      ["reasoning.delta", { text: "bí mật nội bộ" }],
    ]);
    expect(state.thinking).toBe(true);
    expect(state.text).toBe("");
  });

  it("takes the final text from message.complete", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "một phần" }],
      ["message.complete", { text: "câu trả lời đầy đủ" }],
    ]);
    expect(state.text).toBe("câu trả lời đầy đủ");
    expect(state.done).toBe(true);
    expect(state.tool).toBeNull();
  });

  it("keeps the streamed text when message.complete carries none", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "đã viết" }],
      ["message.complete", {}],
    ]);
    expect(state.text).toBe("đã viết");
    expect(state.done).toBe(true);
  });

  it("does not double-print interim text that already streamed", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "phần đã stream" }],
      ["message.interim", { already_streamed: true, text: "phần đã stream" }],
    ]);
    expect(state.text).toBe("phần đã stream");
  });

  it("appends interim commentary that never streamed", () => {
    const state = feed([
      ["message.start"],
      ["message.delta", { text: "A" }],
      ["message.interim", { text: "B" }],
    ]);
    expect(state.text).toBe("A\n\nB");
  });

  it("surfaces an error and ends the turn", () => {
    const state = feed([["message.start"], ["error", { text: "hết hạn mức" }]]);
    expect(state.error).toBe("hết hạn mức");
    expect(state.done).toBe(true);
  });

  it("passes unknown event types through untouched", () => {
    const before = feed([["message.start"], ["message.delta", { text: "x" }]]);
    expect(
      reduceLiveTurn(before, {
        seq: null,
        sessionId: null,
        type: "pet.hatch.progress",
      }),
    ).toBe(before);
  });
});

describe("shouldClearLiveTurn", () => {
  it("hands over once the store has the finished assistant message", () => {
    const done = feed([["message.start"], ["message.complete", { text: "ok" }]]);
    expect(shouldClearLiveTurn(done, "assistant", true)).toBe(true);
  });

  it("holds the bubble while the turn is still streaming", () => {
    const live = feed([["message.start"], ["message.delta", { text: "ok" }]]);
    expect(shouldClearLiveTurn(live, "assistant", true)).toBe(false);
  });

  it("holds the bubble when the store's last message is not the answer", () => {
    const done = feed([["message.start"], ["message.complete", { text: "ok" }]]);
    expect(shouldClearLiveTurn(done, "user", true)).toBe(false);
    expect(shouldClearLiveTurn(done, "assistant", false)).toBe(false);
  });
});

describe("stallWarningVi", () => {
  it("translates the liveness watchdog, keeping the number of seconds", () => {
    const vi = stallWarningVi(
      "⚠️ This turn stopped making progress (612s without activity); " +
        "attempting recovery so the session can continue.",
    );
    expect(vi).toContain("đang kẹt");
    expect(vi).toContain("612 giây");
  });

  it("says plainly when the watchdog already gave up", () => {
    const vi = stallWarningVi(
      "⚠️ Turn aborted by the liveness watchdog (900s without activity); " +
        "lease renewal stopped so the session can be reclaimed.",
    );
    expect(vi).toContain("tự huỷ");
    expect(vi).toContain("gửi lại");
  });

  it("passes on the repeated-transcript-repair notice", () => {
    expect(stallWarningVi("transcript sanitizer healed 5 times")).toContain(
      "/new",
    );
  });

  it("ignores warnings that are not about a stuck turn", () => {
    // status.update carries every kind of warn; hijacking the waiting bubble
    // for a compression hiccup would train the user to ignore it.
    expect(stallWarningVi("Auxiliary compression model unavailable")).toBeNull();
    expect(stallWarningVi("   ")).toBeNull();
  });
});

describe("reduceLiveTurn · status.update", () => {
  const frame = (kind: string, text: string) => ({
    payload: { kind, text },
    seq: 1,
    sessionId: "gw-1",
    type: "status.update",
  });

  it("marks the turn stalled when the watchdog fires", () => {
    const next = reduceLiveTurn(
      EMPTY_LIVE_TURN,
      frame("warn", "This turn stopped making progress (300s without activity)"),
    );
    expect(next.stalled).toContain("300 giây");
    expect(next.active).toBe(true);
  });

  it("leaves the turn alone for an unrelated warning", () => {
    const next = reduceLiveTurn(EMPTY_LIVE_TURN, frame("warn", "memory flush failed"));
    expect(next).toBe(EMPTY_LIVE_TURN);
  });

  it("ignores non-warn status updates", () => {
    expect(
      reduceLiveTurn(EMPTY_LIVE_TURN, frame("status", "Summarizing…")),
    ).toBe(EMPTY_LIVE_TURN);
  });

  it("clears the stall as soon as text starts arriving again", () => {
    const stalled = reduceLiveTurn(
      EMPTY_LIVE_TURN,
      frame("warn", "This turn stopped making progress (300s without activity)"),
    );
    expect(stalled.stalled).not.toBeNull();
    const moving = reduceLiveTurn(stalled, {
      payload: { text: "xin lỗi anh" },
      seq: 2,
      sessionId: "gw-1",
      type: "message.delta",
    });
    expect(moving.stalled).toBeNull();
  });
});
