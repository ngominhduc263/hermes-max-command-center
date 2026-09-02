import { describe, expect, it } from "vitest";

import { WAITING_LINES, waitingLineAt } from "./chat-waiting-lines";

describe("WAITING_LINES", () => {
  it("has enough lines that a long turn does not repeat quickly", () => {
    // 50 lines × 4.2s ≈ 3½ minutes before the first repeat.
    expect(WAITING_LINES.length).toBeGreaterThanOrEqual(50);
  });

  it("opens every line with an emoji", () => {
    // The changing emoji is what reads as "still alive" at a glance, so a
    // line that lost its own would silently break the effect.
    for (const line of WAITING_LINES) {
      expect(/^\p{Extended_Pictographic}/u.test(line), line).toBe(true);
    }
  });

  it("never starts two lines in a row with the same emoji", () => {
    // Consecutive ticks would otherwise look like nothing moved.
    const emoji = WAITING_LINES.map((line) => [...line][0]);
    for (let i = 1; i < emoji.length; i++) {
      expect(emoji[i], `line ${i}`).not.toBe(emoji[i - 1]);
    }
    // …and the list wraps, so the last and first must differ too.
    expect(emoji.at(-1)).not.toBe(emoji[0]);
  });

  it("has no duplicates", () => {
    expect(new Set(WAITING_LINES).size).toBe(WAITING_LINES.length);
  });

  it("keeps every line short enough for one row", () => {
    for (const line of WAITING_LINES) {
      expect(line.trim()).not.toBe("");
      expect(line.length).toBeLessThanOrEqual(48);
    }
  });
});

describe("waitingLineAt", () => {
  it("walks the list one line at a time", () => {
    expect(waitingLineAt(0, 0, ["a", "b", "c"])).toBe("a");
    expect(waitingLineAt(0, 1, ["a", "b", "c"])).toBe("b");
    expect(waitingLineAt(0, 2, ["a", "b", "c"])).toBe("c");
  });

  it("wraps around instead of running off the end", () => {
    expect(waitingLineAt(0, 3, ["a", "b", "c"])).toBe("a");
    expect(waitingLineAt(2, 5, ["a", "b", "c"])).toBe("b");
  });

  it("starts two turns on different lines via the seed", () => {
    expect(waitingLineAt(0, 0, ["a", "b", "c"])).not.toBe(
      waitingLineAt(1, 0, ["a", "b", "c"]),
    );
  });

  it("survives negative and huge inputs", () => {
    expect(waitingLineAt(-7, -3, ["a", "b", "c"])).toBe("c");
    expect(WAITING_LINES).toContain(waitingLineAt(1e9, 1e9));
  });

  it("returns an empty string rather than crashing on an empty list", () => {
    expect(waitingLineAt(3, 4, [])).toBe("");
  });
});
