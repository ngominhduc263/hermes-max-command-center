import { describe, expect, it } from "vitest";

import {
  branchLabelVi,
  diffLabel,
  hasChanges,
  parseGitStatus,
  summaryVi,
  syncLabel,
  unavailableReasonVi,
  type GitStatus,
} from "./git-status";

/**
 * The trap in this endpoint is that `ahead: 0, behind: 0` means two different
 * things — "level with the upstream" and "there is no upstream to compare
 * with" — and nothing in the payload distinguishes them. Anything that reads
 * zero as "in sync" is telling the user something Hermes did not say.
 */

const CLEAN: GitStatus = {
  added: 0,
  ahead: 0,
  behind: 0,
  branch: "main",
  changed: 0,
  conflicted: 0,
  detached: false,
  removed: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
};

describe("parseGitStatus", () => {
  it("reads a real status payload", () => {
    const status = parseGitStatus({
      added: 27737,
      ahead: 233,
      behind: 1,
      branch: "main",
      changed: 12,
      conflicted: 0,
      defaultBranch: "main",
      detached: false,
      removed: 118,
      staged: 2,
      unstaged: 9,
      untracked: 1,
    })!;
    expect(status).toMatchObject({ ahead: 233, behind: 1, branch: "main" });
    expect(status.added).toBe(27737);
    expect(status.removed).toBe(118);
  });

  it("treats the null body as 'not a repo', not as an error", () => {
    // The endpoint answers JSON null rather than 404 when the path is not a
    // directory or git fails, so this is a successful response.
    expect(parseGitStatus(null)).toBeNull();
    expect(parseGitStatus({})).toBeNull();
  });

  it("keeps a detached HEAD, which has no branch name", () => {
    const status = parseGitStatus({ branch: "", detached: true })!;
    expect(status.detached).toBe(true);
    expect(branchLabelVi(status)).toBe("HEAD rời");
  });

  it("clamps nonsense counts to zero instead of rendering them", () => {
    const status = parseGitStatus({
      added: -4,
      ahead: Number.NaN,
      branch: "main",
    })!;
    expect(status.added).toBe(0);
    expect(status.ahead).toBe(0);
  });
});

describe("syncLabel", () => {
  it("draws only the side that has commits", () => {
    expect(syncLabel({ ...CLEAN, ahead: 233, behind: 1 })).toBe("↑233 ↓1");
    expect(syncLabel({ ...CLEAN, ahead: 3 })).toBe("↑3");
    expect(syncLabel({ ...CLEAN, behind: 2 })).toBe("↓2");
  });

  it("renders nothing at zero rather than '↑0 ↓0'", () => {
    // Zero here can mean "no upstream configured", so drawing it would state
    // something the payload does not support.
    expect(syncLabel(CLEAN)).toBe("");
  });
});

describe("diffLabel", () => {
  it("uses a real minus sign, not a hyphen", () => {
    expect(diffLabel({ ...CLEAN, added: 27737, removed: 118 })).toBe(
      "+27737 −118",
    );
  });

  it("omits a side with no lines", () => {
    expect(diffLabel({ ...CLEAN, added: 5 })).toBe("+5");
    expect(diffLabel(CLEAN)).toBe("");
  });
});

describe("hasChanges", () => {
  it("is false for a clean, level repo", () => {
    expect(hasChanges(CLEAN)).toBe(false);
  });

  it("is true as soon as anything differs", () => {
    expect(hasChanges({ ...CLEAN, changed: 1 })).toBe(true);
    expect(hasChanges({ ...CLEAN, behind: 1 })).toBe(true);
  });
});

describe("summaryVi", () => {
  it("refuses to claim 'in sync' when it cannot know", () => {
    // This is the whole point: 0/0 is ambiguous and the tooltip says so.
    const text = summaryVi(CLEAN);
    expect(text).toContain("chưa so được với remote");
    expect(text).not.toContain("đã đồng bộ");
  });

  it("spells out what the arrows mean", () => {
    const text = summaryVi({ ...CLEAN, ahead: 233, behind: 1, changed: 12 });
    expect(text).toContain("đi trước 233 commit");
    expect(text).toContain("đi sau 1 commit");
    expect(text).toContain("12 file thay đổi");
  });

  it("calls a clean tree clean", () => {
    expect(summaryVi(CLEAN)).toContain("cây làm việc sạch");
  });

  it("surfaces conflicts, which matter more than the counts", () => {
    expect(summaryVi({ ...CLEAN, changed: 3, conflicted: 2 })).toContain(
      "2 file xung đột",
    );
  });
});

describe("unavailableReasonVi", () => {
  it("separates 'no cwd' from 'not a repo'", () => {
    // They need different things from the user, so one message for both
    // would be unhelpful.
    expect(unavailableReasonVi("", null)).toContain("thư mục làm việc");
    expect(unavailableReasonVi("/home/x", null)).toContain("không phải kho git");
    expect(unavailableReasonVi("/home/x", CLEAN)).toBe("");
  });
});
