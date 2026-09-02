import { describe, expect, it } from "vitest";

import {
  backgroundNoteVi,
  branchProblemVi,
  branchResultVi,
  btwNoteVi,
  compressConfirmVi,
  compressProblemVi,
  parseBranchResult,
  parseCompressOutcome,
  parseSideAnswer,
  parseSideTaskId,
  parseUndoRemoved,
  sideAnswerFailed,
  steerModeNoteVi,
  steerProblemVi,
  steerStatusVi,
  undoProblemVi,
  undoResultVi,
} from "./session-tools";

/**
 * Each of these controls has a way to mislead the user that the runtime will
 * not stop. These pin the four that matter most: a background question that
 * cannot see the conversation, a compress that cannot be undone, a steer that
 * silently attaches to the next turn, and a failure delivered as ordinary
 * answer text.
 */

describe("side questions", () => {
  it("reads a btw answer, question echo included", () => {
    expect(
      parseSideAnswer("btw", {
        question: "file nào đang mở?",
        task_id: "btw_a1b2c3",
        text: "Đang mở ba file.",
      }),
    ).toEqual({
      failed: false,
      kind: "btw",
      question: "file nào đang mở?",
      taskId: "btw_a1b2c3",
      text: "Đang mở ba file.",
    });
  });

  it("spots the failure that arrives dressed as an answer", () => {
    // Both handlers already returned ok; the exception is delivered as the
    // completion text. Without this sniff the UI shows a stack trace as if
    // it were the reply.
    expect(sideAnswerFailed("error: provider timed out")).toBe(true);
    expect(sideAnswerFailed("  ERROR: nope")).toBe(true);
    expect(sideAnswerFailed("errors are common in this codebase")).toBe(false);
    expect(
      parseSideAnswer("background", { task_id: "bg_1", text: "error: boom" })
        ?.failed,
    ).toBe(true);
  });

  it("ignores a payload with no task id, which could not be matched up", () => {
    expect(parseSideAnswer("btw", { text: "mồ côi" })).toBeNull();
    expect(parseSideTaskId({ task_id: " bg_9 " })).toBe("bg_9");
  });

  it("warns that a background question has no conversation context", () => {
    // prompt.background builds a fresh agent with no parent history. Calling
    // it "ask in the background" without this note would be a lie.
    expect(backgroundNoteVi()).toContain("phiên MỚI");
    expect(backgroundNoteVi()).toContain("không thấy");
    expect(btwNoteVi()).toContain("không ghi gì");
  });
});

describe("parseCompressOutcome", () => {
  it("shows Hermes's own headline rather than one derived from counts", () => {
    // "refused because the summary would grow the conversation" and "nothing
    // to do" have the same counts and completely different meanings.
    const outcome = parseCompressOutcome({
      after_messages: 40,
      before_messages: 40,
      removed: 0,
      status: "compressed",
      summary: {
        headline: "Compression refused (summary would grow the conversation): 40 messages preserved",
        token_line: "12k → 12k",
      },
    });
    expect(outcome.headline).toContain("refused");
    expect(outcome.changed).toBe(false);
  });

  it("handles the held-lock reply, which carries no status key at all", () => {
    const outcome = parseCompressOutcome({
      compressed: false,
      lock_held: true,
      message: "another compression is running",
    });
    expect(outcome.lockHeld).toBe(true);
    expect(outcome.changed).toBe(false);
    expect(outcome.headline).toContain("đang chạy");
  });

  it("reports a real compression as changed", () => {
    const outcome = parseCompressOutcome({
      after_messages: 12,
      before_messages: 60,
      removed: 48,
      status: "compressed",
      summary: { headline: "Compressed: 60 → 12 messages" },
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.beforeMessages).toBe(60);
    expect(outcome.afterMessages).toBe(12);
  });

  it("does not call an aborted run a success", () => {
    expect(parseCompressOutcome({ removed: 0, status: "aborted" }).changed).toBe(
      false,
    );
  });

  it("refuses to run mid-turn, and says why before the server does", () => {
    expect(compressProblemVi(true)).toContain("dừng lượt");
    expect(compressProblemVi(false)).toBe("");
  });

  it("admits in the confirm that there is no undo", () => {
    expect(compressConfirmVi()).toContain("KHÔNG hoàn tác");
  });
});

describe("undo", () => {
  it("counts rows removed", () => {
    expect(parseUndoRemoved({ removed: 4 })).toBe(4);
    expect(parseUndoRemoved({})).toBe(0);
  });

  it("says files are untouched, because session.undo never touches disk", () => {
    // A user who reads "undo" as "put my files back" would be badly surprised.
    expect(undoResultVi(4)).toContain("File");
    expect(undoResultVi(4)).toContain("vẫn còn nguyên");
    expect(undoResultVi(0)).toContain("Không có lượt");
  });

  it("blocks while a turn is running", () => {
    expect(undoProblemVi(true)).toContain("dừng lượt");
  });
});

describe("branch", () => {
  it("reads the new session's identity and its parent link", () => {
    expect(
      parseBranchResult({
        message_count: 20,
        parent: "20260902_1200_aaa",
        session_id: "a1b2c3d4",
        stored_session_id: "20260902_1400_bbb",
        title: "Thử hướng khác",
      }),
    ).toMatchObject({
      messageCount: 20,
      parent: "20260902_1200_aaa",
      sessionId: "a1b2c3d4",
    });
  });

  it("guards the mid-turn fork the gateway itself allows", () => {
    // session.branch has no busy guard, so a fork taken now contains half a
    // turn. Nothing server-side will stop it.
    expect(branchProblemVi(true, true)).toContain("nửa lượt");
    expect(branchProblemVi(false, false)).toContain("Chưa có tin nhắn");
    expect(branchProblemVi(false, true)).toBe("");
  });

  it("reassures that the original survives", () => {
    expect(
      branchResultVi({
        messageCount: 20,
        parent: "p",
        sessionId: "s",
        storedSessionId: "st",
        title: "Thử hướng khác",
      }),
    ).toContain("Bản gốc vẫn còn nguyên");
  });
});

describe("steer / redirect", () => {
  it("refuses a steer on an idle session — the real footgun", () => {
    // The gateway accepts it, answers "queued", and the text then surfaces
    // inside the NEXT turn's tool results with nothing in the transcript.
    expect(steerProblemVi("steer", "đổi hướng đi", false)).toContain(
      "khi Hermes đang chạy",
    );
    expect(steerProblemVi("redirect", "đổi hướng đi", false)).toContain(
      "Không có lượt nào",
    );
  });

  it("allows it while a turn is running", () => {
    expect(steerProblemVi("steer", "đổi hướng đi", true)).toBe("");
  });

  it("still requires text", () => {
    expect(steerProblemVi("redirect", "   ", true)).toBe("Chưa nhập nội dung.");
  });

  it("does not promise the turn was cut when it may only have been nudged", () => {
    // While tools execute, Hermes downgrades a redirect to a steer and still
    // answers "redirected". No field distinguishes them.
    const text = steerStatusVi("redirect", { status: "redirected" });
    expect(text).toContain("bước kế tiếp");
    expect(text).not.toContain("đã cắt");
  });

  it("explains the queued and rejected outcomes rather than showing a raw status", () => {
    expect(steerStatusVi("redirect", { status: "queued" })).toContain(
      "lượt kế tiếp",
    );
    expect(steerStatusVi("steer", { status: "rejected" })).toContain(
      "vừa kết thúc",
    );
  });

  it("describes the difference between the two modes", () => {
    expect(steerModeNoteVi("steer")).toContain("không cắt ngang");
    expect(steerModeNoteVi("redirect")).toContain("cắt");
  });
});
