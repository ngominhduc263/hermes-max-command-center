import { describe, expect, it } from "vitest";

import {
  DIFF_TRUNCATE_CHARS,
  diffLooksTruncated,
  disabledNoteVi,
  emptyDiffNoteVi,
  filesInDiff,
  parseCheckpoints,
  parseRestoreResult,
  parseRollbackDiff,
  restoreConfirmVi,
  restoreResultVi,
  scopeNoteVi,
  truncatedNoteVi,
} from "./hermes-rollback";

/**
 * This is the most dangerous panel in the Dashboard: one click can overwrite
 * files the user edited by hand and drop an exchange that cannot be recovered.
 * These tests exist to keep the warnings honest, not to check parsing.
 */

describe("parseCheckpoints", () => {
  it("reads an enabled list and derives the short hash the RPC drops", () => {
    const list = parseCheckpoints({
      checkpoints: [
        { hash: "abcdef1234567890", message: "", timestamp: "2026-09-02 14:00" },
      ],
      enabled: true,
    });
    expect(list.enabled).toBe(true);
    expect(list.checkpoints[0]).toEqual({
      hash: "abcdef1234567890",
      shortHash: "abcdef12",
      timestamp: "2026-09-02 14:00",
    });
  });

  it("reports the disabled case as disabled, not as an empty list", () => {
    // These look identical if you only check `checkpoints.length`, but they
    // need completely different messages on screen.
    const off = parseCheckpoints({ checkpoints: [], enabled: false });
    const empty = parseCheckpoints({ checkpoints: [], enabled: true });
    expect(off.enabled).toBe(false);
    expect(empty.enabled).toBe(true);
  });

  it("names the env var, because the config.yaml key does nothing here", () => {
    // The TUI gateway reads HERMES_TUI_CHECKPOINTS and ignores
    // checkpoints.enabled. Pointing a user at config.yaml would waste an hour.
    expect(disabledNoteVi()).toContain("HERMES_TUI_CHECKPOINTS");
    expect(disabledNoteVi()).toContain("KHÔNG có tác dụng");
  });
});

describe("parseRollbackDiff", () => {
  it("flags the silent 4000-character slice", () => {
    const long = "x".repeat(DIFF_TRUNCATE_CHARS);
    expect(diffLooksTruncated(long)).toBe(true);
    expect(diffLooksTruncated("short")).toBe(false);
    expect(parseRollbackDiff({ diff: long, stat: "1 file" }).truncated).toBe(true);
    expect(truncatedNoteVi()).toContain("4000");
  });

  it("calls an empty reply ambiguous rather than 'no changes'", () => {
    // The RPC discards the manager's success/error, so a bad hash and a
    // clean tree produce the same empty payload.
    const parsed = parseRollbackDiff({ diff: "", stat: "" });
    expect(parsed.ambiguousEmpty).toBe(true);
    expect(emptyDiffNoteVi()).toContain("nuốt lỗi");
  });

  it("does not call a real diff ambiguous", () => {
    expect(parseRollbackDiff({ diff: "+++ b/a.ts\n+x", stat: "1" }).ambiguousEmpty).toBe(
      false,
    );
  });
});

describe("filesInDiff", () => {
  it("lists each changed file once", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "+one",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "+two",
    ].join("\n");
    expect(filesInDiff(diff)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("skips deletions, which have no b-side path", () => {
    expect(filesInDiff("--- a/gone.ts\n+++ /dev/null")).toEqual([]);
  });

  it("returns nothing for an empty diff", () => {
    expect(filesInDiff("")).toEqual([]);
  });
});

describe("restoreConfirmVi", () => {
  it("warns that a whole-tree restore overwrites hand-edits", () => {
    // The gateway calls restore(safe=False). The messaging gateway uses
    // safe=True and the slash help describes THAT one, so a user's
    // expectation here is likely to be wrong.
    const text = restoreConfirmVi("abcdef12");
    expect(text).toContain("tự sửa tay");
  });

  it("warns that exactly one exchange is dropped, whatever was picked", () => {
    // len(user_indices) - 1 is the last turn, unrelated to the checkpoint.
    const text = restoreConfirmVi("abcdef12");
    expect(text).toContain("1 lượt hội thoại cuối");
    expect(text).toContain("bất kể anh chọn checkpoint nào");
  });

  it("says the files are recoverable but the exchange is not", () => {
    expect(restoreConfirmVi("abcdef12")).toContain("lượt hội thoại thì không");
  });

  it("uses calmer wording for a single file, which never touches history", () => {
    const text = restoreConfirmVi("abcdef12", "src/a.ts");
    expect(text).toContain("src/a.ts");
    expect(text).toContain("Hội thoại không bị đụng tới");
    expect(text).not.toContain("1 lượt hội thoại cuối");
  });
});

describe("parseRestoreResult / restoreResultVi", () => {
  it("treats success:false as a failure despite the ok envelope", () => {
    // A failed restore still returns JSON-RPC success.
    const result = parseRestoreResult({ error: "unknown hash", success: false });
    expect(result.success).toBe(false);
    expect(restoreResultVi(result)).toContain("unknown hash");
  });

  it("mentions the dropped exchange when history was rewound", () => {
    const result = parseRestoreResult({
      history_removed: 3,
      restored_to: "abcdef12",
      success: true,
    });
    expect(restoreResultVi(result)).toContain("bỏ 3 tin");
  });

  it("says nothing about history for a single-file restore", () => {
    const result = parseRestoreResult({
      file: "src/a.ts",
      restored_to: "abcdef12",
      success: true,
    });
    expect(restoreResultVi(result)).toContain("src/a.ts");
    expect(restoreResultVi(result)).not.toContain("hội thoại");
  });
});

describe("scopeNoteVi", () => {
  it("says checkpoints follow the folder, not the chat", () => {
    expect(scopeNoteVi()).toContain("THƯ MỤC");
  });
});
