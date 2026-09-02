import { describe, expect, it } from "vitest";

import {
  approvalOutcomeVi,
  APPROVAL_CHOICE_VI,
  buildApprovalResponse,
  COMMAND_PREVIEW_LINES,
  parseApprovalRequest,
  parsePendingApprovals,
  splitCommandPreview,
} from "./chat-approval";

/** A payload shaped like the one tools/approval.py actually emits. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    choices: ["once", "session", "always", "deny"],
    command: "rm -rf /tmp/build",
    description: "recursive delete",
    pattern_key: "recursive delete",
    pattern_keys: ["recursive delete"],
    request_id: "abc123",
    ...overrides,
  };
}

describe("parseApprovalRequest", () => {
  it("explains the request with the same Vietnamese the panel uses", () => {
    const request = parseApprovalRequest(payload());
    expect(request?.vi).toContain("Xoá đệ quy cả thư mục con");
    expect(request?.risk).toBe("critical");
    expect(request?.requestId).toBe("abc123");
    expect(request?.command).toBe("rm -rf /tmp/build");
  });

  it("explains the execute_code gate too, not just command patterns", () => {
    // This is the one haruto actually hit, and the one the terminal shows in
    // English: "execute_code script execution. The script can spawn…".
    const request = parseApprovalRequest(
      payload({
        command: "execute_code <<'PY'\nimport json\nPY",
        description:
          "execute_code script execution. The script can spawn subprocesses " +
          "or mutate files without passing through terminal command approval.",
        pattern_key: "execute_code",
      }),
    );
    expect(request?.vi).toContain("Chạy mã tuỳ ý bằng execute_code");
    expect(request?.risk).toBe("critical");
  });

  it("falls back to the gateway's own line for a key it does not know", () => {
    const request = parseApprovalRequest(
      payload({ description: "some new guard", pattern_key: "brand new key" }),
    );
    expect(request?.vi).toBe("some new guard");
  });

  it("still says something when there is no description at all", () => {
    const request = parseApprovalRequest(
      payload({ description: "", pattern_key: "" }),
    );
    expect(request?.vi).toContain("nguy hiểm");
  });

  it("refuses a request with no id, because it could never be answered", () => {
    expect(parseApprovalRequest(payload({ request_id: "" }))).toBeNull();
    expect(parseApprovalRequest(payload({ request_id: 7 }))).toBeNull();
    expect(parseApprovalRequest(null)).toBeNull();
    expect(parseApprovalRequest("nope")).toBeNull();
  });

  it("keeps only the choices the gateway offered, in a fixed order", () => {
    // A tirith-flagged command drops "always"; smart-deny drops more.
    expect(
      parseApprovalRequest(payload({ choices: ["deny", "once"] }))?.choices,
    ).toEqual(["once", "deny"]);
    expect(
      parseApprovalRequest(payload({ choices: ["once", "session", "deny"] }))
        ?.choices,
    ).toEqual(["once", "session", "deny"]);
  });

  it("offers all four when the payload named none", () => {
    expect(parseApprovalRequest(payload({ choices: [] }))?.choices).toEqual([
      "once",
      "session",
      "always",
      "deny",
    ]);
  });

  it("ignores choices Hermes never uses", () => {
    expect(
      parseApprovalRequest(payload({ choices: ["once", "sudo", "deny"] }))
        ?.choices,
    ).toEqual(["once", "deny"]);
  });

  it("collapses whitespace in the English line so it reads as one caption", () => {
    expect(
      parseApprovalRequest(payload({ description: "  a\n  b   c  " }))
        ?.description,
    ).toBe("a b c");
  });
});

describe("parsePendingApprovals", () => {
  it("reads the queue, keeping order", () => {
    const list = parsePendingApprovals({
      approvals: [payload({ request_id: "one" }), payload({ request_id: "two" })],
    });
    expect(list.map((entry) => entry.requestId)).toEqual(["one", "two"]);
  });

  it("drops duplicates and unusable rows", () => {
    const list = parsePendingApprovals({
      approvals: [
        payload({ request_id: "one" }),
        payload({ request_id: "one" }),
        payload({ request_id: "" }),
        null,
      ],
    });
    expect(list).toHaveLength(1);
  });

  it("returns nothing for a reply that is not one", () => {
    expect(parsePendingApprovals({})).toEqual([]);
    expect(parsePendingApprovals({ approvals: "no" })).toEqual([]);
    expect(parsePendingApprovals(null)).toEqual([]);
  });
});

describe("APPROVAL_CHOICE_VI", () => {
  it("labels all four, and says what each one costs", () => {
    for (const choice of ["once", "session", "always", "deny"] as const) {
      expect(APPROVAL_CHOICE_VI[choice].label.trim()).not.toBe("");
      expect(APPROVAL_CHOICE_VI[choice].vi.trim()).not.toBe("");
    }
    // "always" is the one that writes to disk — it must say so.
    expect(APPROVAL_CHOICE_VI.always.vi).toContain("vĩnh viễn");
  });
});

describe("buildApprovalResponse", () => {
  it("sends the id the gateway resolves by, not the pattern", () => {
    const request = parseApprovalRequest(payload())!;
    expect(buildApprovalResponse("gw-9", request, "once")).toEqual({
      choice: "once",
      request_id: "abc123",
      session_id: "gw-9",
    });
  });
});

describe("approvalOutcomeVi", () => {
  it("points at where an 'always' can be taken back", () => {
    expect(approvalOutcomeVi("always")).toContain("thu hồi");
  });

  it("has a line for every choice", () => {
    for (const choice of ["once", "session", "always", "deny"] as const) {
      expect(approvalOutcomeVi(choice).trim()).not.toBe("");
    }
  });
});

describe("splitCommandPreview", () => {
  it("shows a short command whole", () => {
    expect(splitCommandPreview("one\ntwo")).toEqual({
      hidden: 0,
      shown: "one\ntwo",
    });
  });

  it("folds a long one and counts what it hid", () => {
    const command = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const { shown, hidden } = splitCommandPreview(command);
    expect(shown.split("\n")).toHaveLength(COMMAND_PREVIEW_LINES);
    expect(hidden).toBe(20 - COMMAND_PREVIEW_LINES);
  });

  it("does not count trailing blank lines as content", () => {
    expect(splitCommandPreview("one\ntwo\n\n\n").hidden).toBe(0);
  });
});
