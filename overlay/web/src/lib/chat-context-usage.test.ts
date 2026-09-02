import { describe, expect, it } from "vitest";

import {
  compressionsVi,
  contextAdviceVi,
  contextLabelVi,
  contextLevel,
  EMPTY_CONTEXT_USAGE,
  formatTokens,
  hasGauge,
  mergeContextUsage,
  parseContextBreakdown,
  parseContextUsage,
  thresholdVi,
} from "./chat-context-usage";

/** A `usage` object shaped like tui_gateway/server.py's `_get_usage`. */
function usage(overrides: Record<string, unknown> = {}) {
  return {
    calls: 12,
    completion: 4_000,
    compressions: 2,
    context_max: 200_000,
    context_percent: 39,
    context_used: 78_000,
    input: 60_000,
    model: "claude-sonnet-4",
    output: 4_000,
    prompt: 74_000,
    total: 82_000,
    ...overrides,
  };
}

describe("parseContextUsage", () => {
  it("reads the gauge the gateway measured", () => {
    expect(parseContextUsage(usage())).toEqual({
      apiCalls: 12,
      compressions: 2,
      max: 200_000,
      model: "claude-sonnet-4",
      percent: 39,
      totalTokens: 82_000,
      used: 78_000,
    });
  });

  it("unwraps a message.complete payload", () => {
    // The event is {text, usage, status}; the gauge lives one level in.
    const parsed = parseContextUsage({ status: "complete", text: "…", usage: usage() });
    expect(parsed.percent).toBe(39);
  });

  it("reports no gauge when the gateway withheld one", () => {
    // _get_usage omits context_* entirely for an engine that does not track
    // window occupancy (#50421). Absent must stay absent, not become 0%.
    const parsed = parseContextUsage(
      usage({ context_max: undefined, context_percent: undefined, context_used: undefined }),
    );
    expect(parsed.percent).toBeNull();
    expect(parsed.used).toBeNull();
    expect(hasGauge(parsed)).toBe(false);
  });

  it("treats a zero occupancy as not measured rather than an empty window", () => {
    // The -1 "compression just ran" sentinel is clamped to 0 upstream; 0 means
    // unknown there, so it must not render as a confident 0%.
    expect(parseContextUsage(usage({ context_used: 0 })).percent).toBeNull();
  });

  it("derives the percent when only that field is missing", () => {
    const parsed = parseContextUsage(usage({ context_percent: undefined }));
    expect(parsed.percent).toBe(39);
  });

  it("clamps an out-of-range percent instead of trusting it", () => {
    expect(parseContextUsage(usage({ context_percent: 190 })).percent).toBe(100);
    expect(parseContextUsage(usage({ context_percent: -5 })).percent).toBe(0);
  });

  it("survives a reply that is not one", () => {
    expect(parseContextUsage(null)).toEqual(EMPTY_CONTEXT_USAGE);
    expect(parseContextUsage("nope")).toEqual(EMPTY_CONTEXT_USAGE);
    expect(parseContextUsage({}).compressions).toBe(0);
  });
});

describe("mergeContextUsage", () => {
  const measured = parseContextUsage(usage());
  const blank = parseContextUsage(
    usage({ context_max: undefined, context_percent: undefined, context_used: undefined }),
  );

  it("keeps the last real reading when a turn reports no gauge", () => {
    // Otherwise every interrupted turn would blank the gauge and bring it back.
    expect(mergeContextUsage(measured, blank).percent).toBe(39);
  });

  it("takes a newer measurement over an older one", () => {
    const later = parseContextUsage(usage({ context_percent: 71, context_used: 142_000 }));
    expect(mergeContextUsage(measured, later).percent).toBe(71);
  });

  it("never lets the compression count go backwards", () => {
    const fewer = parseContextUsage(usage({ compressions: 0 }));
    expect(mergeContextUsage(measured, fewer).compressions).toBe(2);
  });

  it("adopts the first reading over an empty starting state", () => {
    expect(mergeContextUsage(EMPTY_CONTEXT_USAGE, measured).used).toBe(78_000);
  });
});

describe("parseContextBreakdown", () => {
  const payload = {
    categories: [
      { color: "#aaa", id: "conversation", label: "Conversation", tokens: 50_000 },
      { color: "#bbb", id: "system_prompt", label: "System prompt", tokens: 9_000 },
      { color: "#ccc", id: "skills", label: "Skills", tokens: 0 },
      { color: "#ddd", id: "brand_new", label: "Brand new", tokens: 120 },
    ],
    context_max: 200_000,
    context_used: 78_000,
    estimated_total: 59_120,
    model: "claude-sonnet-4",
  };

  it("translates the categories and puts the biggest first", () => {
    const parsed = parseContextBreakdown(payload);
    expect(parsed.categories.map((entry) => entry.label)).toEqual([
      "Hội thoại",
      "Lời nhắc hệ thống",
      "Brand new",
    ]);
  });

  it("drops empty categories rather than drawing zero-width slices", () => {
    expect(
      parseContextBreakdown(payload).categories.some((entry) => entry.id === "skills"),
    ).toBe(false);
  });

  it("computes the percent from the figures it was given", () => {
    expect(parseContextBreakdown(payload).percent).toBe(39);
  });

  it("keeps the estimated total separate from the measured usage", () => {
    // They are different numbers by design: one is a heuristic sum over
    // categories, the other is the provider-anchored occupancy.
    const parsed = parseContextBreakdown(payload);
    expect(parsed.estimatedTotal).toBe(59_120);
    expect(parsed.used).toBe(78_000);
  });

  it("survives the agent-less reply, which has no categories", () => {
    const parsed = parseContextBreakdown({
      categories: [],
      context_max: 0,
      context_percent: 0,
      context_used: 0,
    });
    expect(parsed.categories).toEqual([]);
    expect(parsed.percent).toBeNull();
  });

  it("survives a reply that is not one", () => {
    expect(parseContextBreakdown(null).categories).toEqual([]);
  });
});

describe("formatTokens", () => {
  it("scales the unit and uses a Vietnamese decimal comma", () => {
    expect(formatTokens(840)).toBe("840");
    expect(formatTokens(78_000)).toBe("78k");
    expect(formatTokens(128_500)).toBe("129k");
    expect(formatTokens(9_400)).toBe("9,4k");
    expect(formatTokens(1_400_000)).toBe("1,4tr");
  });

  it("does not render a bare zero as a decimal", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("contextLevel / contextLabelVi / contextAdviceVi", () => {
  const at = (percent: number | null) =>
    parseContextUsage(
      usage(
        percent === null
          ? { context_max: undefined, context_percent: undefined, context_used: undefined }
          : { context_percent: percent },
      ),
    );

  it("bands the fill level", () => {
    expect(contextLevel(at(10))).toBe("roomy");
    expect(contextLevel(at(70))).toBe("filling");
    expect(contextLevel(at(92))).toBe("full");
    expect(contextLevel(at(null))).toBe("unknown");
  });

  it("says plainly when there is no reading", () => {
    expect(contextLabelVi(at(null))).toContain("chưa đo được");
    expect(contextAdviceVi(at(null))).toContain("chưa báo số");
  });

  it("shows both numbers and the percent", () => {
    expect(contextLabelVi(at(39))).toBe("78k/200k · 39%");
  });

  it("names Hermes's own command when the window is nearly full", () => {
    // The whole point: the user knows /compact from elsewhere, not /compress.
    expect(contextAdviceVi(at(92))).toContain("/compress");
  });

  it("reassures rather than alarms in the middle band", () => {
    expect(contextAdviceVi(at(70))).toContain("tự nén");
  });
});

describe("compressionsVi", () => {
  it("counts what Hermes already did", () => {
    expect(compressionsVi(parseContextUsage(usage()))).toContain("2 lần");
  });

  it("says none rather than 'nén 0 lần'", () => {
    expect(compressionsVi(parseContextUsage(usage({ compressions: 0 })))).toContain(
      "chưa lần nào",
    );
  });
});

describe("thresholdVi", () => {
  it("reports the configured ratio as a percent", () => {
    expect(thresholdVi({ compression: { threshold: 0.5 } })).toContain("50%");
  });

  it("hedges, because the effective threshold is raised where we cannot see", () => {
    // The small-window floor (0.75) and the Codex autoraise (0.85) both happen
    // inside the agent and are exposed over no RPC.
    expect(thresholdVi({ compression: { threshold: 0.5 } })).toContain("nâng cao hơn");
  });

  it("says nothing at all rather than guessing from a missing config", () => {
    expect(thresholdVi({})).toBe("");
    expect(thresholdVi(null)).toBe("");
    expect(thresholdVi({ compression: { threshold: "half" } })).toBe("");
    expect(thresholdVi({ compression: { threshold: 5 } })).toBe("");
  });
});
