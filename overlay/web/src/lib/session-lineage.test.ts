import { describe, expect, it } from "vitest";

import {
  isDelegatedSession,
  isToolSession,
  mayFollowDescendant,
  refusedFollowReasonVi,
} from "./session-lineage";

/**
 * The failure these guard against is severe and silent: the chat followed the
 * descendant chain into a sub-agent's private session, rewrote the URL, and the
 * user's actual conversation disappeared from the Dashboard while the Terminal
 * kept showing it. So the tests are written around real row shapes.
 */

/** A session row as `GET /api/sessions/{id}` returns it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "20260902_081054_bd283c",
    model_config: null,
    parent_session_id: null,
    source: "tui",
    ...overrides,
  };
}

describe("isDelegatedSession", () => {
  it("recognises a sub-agent session by Hermes's own marker", () => {
    // `_delegate_from` is written by delegate_task and is exactly what
    // list_sessions_rich filters on to keep these out of the sidebar.
    expect(
      isDelegatedSession(
        row({
          model_config: JSON.stringify({ _delegate_from: "20260902_080000_aaa" }),
          parent_session_id: "20260902_080000_aaa",
        }),
      ),
    ).toBe(true);
  });

  it("accepts an already-parsed model_config too", () => {
    expect(
      isDelegatedSession(row({ model_config: { _delegate_from: "parent-1" } })),
    ).toBe(true);
  });

  it("is not fooled by an empty or blank marker", () => {
    expect(isDelegatedSession(row({ model_config: { _delegate_from: "" } }))).toBe(
      false,
    );
    expect(isDelegatedSession(row({ model_config: { _delegate_from: "  " } }))).toBe(
      false,
    );
  });

  it("leaves an ordinary session alone", () => {
    expect(isDelegatedSession(row())).toBe(false);
    expect(isDelegatedSession(row({ model_config: "{}" }))).toBe(false);
    expect(isDelegatedSession(null)).toBe(false);
  });

  it("does not choke on unparseable model_config", () => {
    expect(isDelegatedSession(row({ model_config: "{not json" }))).toBe(false);
    expect(isDelegatedSession(row({ model_config: 7 }))).toBe(false);
    expect(isDelegatedSession(row({ model_config: ["a"] }))).toBe(false);
  });

  it("does not mistake a branch child for a delegation", () => {
    // /branch writes `_branched_from`; that is a user-visible fork and a
    // different question from a sub-agent's private session.
    expect(
      isDelegatedSession(row({ model_config: { _branched_from: "parent-1" } })),
    ).toBe(false);
  });
});

describe("isToolSession", () => {
  it("spots a tool-owned sidecar session", () => {
    expect(isToolSession(row({ source: "tool" }))).toBe(true);
    expect(isToolSession(row({ source: "tui" }))).toBe(false);
  });
});

describe("mayFollowDescendant", () => {
  it("follows an ordinary continuation, which is what the resolver is for", () => {
    // A /model switch creates a child; continuing into it is the intended
    // behaviour and must not regress.
    expect(
      mayFollowDescendant(row({ parent_session_id: "20260902_080000_aaa" })),
    ).toBe(true);
  });

  it("refuses to follow into a sub-agent's session", () => {
    expect(
      mayFollowDescendant(row({ model_config: { _delegate_from: "parent-1" } })),
    ).toBe(false);
  });

  it("refuses to follow into a tool sidecar session", () => {
    expect(mayFollowDescendant(row({ source: "tool" }))).toBe(false);
  });

  it("refuses to follow into a branch the user forked deliberately", () => {
    // session.branch leaves the parent live and the session list shows both
    // as peers. Being the newest child, a branch would otherwise win the
    // descendant walk and silently replace the parent the user opened.
    expect(
      mayFollowDescendant(row({ model_config: { _branched_from: "parent-1" } })),
    ).toBe(false);
  });

  it("still follows an ordinary model-switch continuation", () => {
    // The case the resolver was actually written for must keep working.
    expect(mayFollowDescendant(row({ model_config: { some_other: "x" } }))).toBe(
      true,
    );
  });

  it("refuses when the row could not be read at all", () => {
    // Staying on the session the user asked for is the safe default; hopping
    // to something unverified is how the conversation went missing.
    expect(mayFollowDescendant(null)).toBe(false);
  });
});

describe("refusedFollowReasonVi", () => {
  it("names why, so the refusal is explainable", () => {
    expect(
      refusedFollowReasonVi(row({ model_config: { _delegate_from: "p" } })),
    ).toContain("agent phụ");
    expect(refusedFollowReasonVi(row({ source: "tool" }))).toContain("công cụ");
    expect(
      refusedFollowReasonVi(row({ model_config: { _branched_from: "p" } })),
    ).toContain("nhánh");
  });

  it("says nothing when there was no refusal", () => {
    expect(refusedFollowReasonVi(row())).toBe("");
  });
});
