import { describe, expect, it } from "vitest";

import {
  activityAt,
  applyPinOverrides,
  bucketFor,
  bucketLabelVi,
  groupSessions,
  pinActionVi,
  pinnedCount,
  pinnedNoteVi,
} from "./session-groups";

/**
 * Two things here are easy to get wrong and hard to notice.
 *
 * `last_active` is epoch SECONDS, so a stray ×1000 or the lack of one puts
 * every conversation in 1970 or the year 55000 — and the list still renders,
 * just wrongly. And the buckets have to follow the calendar, not elapsed
 * time: a chat from 11pm last night is Yesterday when read at 1am, and any
 * other answer quietly disagrees with the clock on the wall.
 */

/** 2026-09-02 14:00 local. */
const NOW = new Date(2026, 8, 2, 14, 0, 0);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Local-time epoch seconds, so the buckets are exercised on wall-clock dates. */
const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) => seconds(new Date(year, month, day, hour, minute, 0));

describe("activityAt", () => {
  it("prefers last_active", () => {
    expect(activityAt({ id: "a", last_active: 1000, started_at: 500 })).toBe(1000);
  });

  it("falls back to started_at, which is what the server does", () => {
    expect(activityAt({ id: "a", started_at: 500 })).toBe(500);
    expect(activityAt({ id: "a", last_active: 0, started_at: 500 })).toBe(500);
  });

  it("returns 0 rather than NaN when neither is usable", () => {
    expect(activityAt({ id: "a" })).toBe(0);
  });
});

describe("bucketFor — calendar boundaries, not elapsed hours", () => {
  it("puts this morning in Hôm nay", () => {
    expect(bucketFor(at(2026, 8, 2, 1, 0), NOW)).toBe("today");
  });

  it("puts 11pm last night in Hôm qua, not Hôm nay", () => {
    // Only 15 hours ago, but a different date — the wall clock decides.
    expect(bucketFor(at(2026, 8, 1, 23, 0), NOW)).toBe("yesterday");
  });

  it("does not let Hôm qua leak into 7 ngày qua", () => {
    expect(bucketFor(at(2026, 8, 1, 0, 1), NOW)).toBe("yesterday");
    expect(bucketFor(at(2026, 7, 31, 23, 59), NOW)).toBe("week");
  });

  it("walks out through the week, month and older buckets", () => {
    expect(bucketFor(at(2026, 7, 28, 12, 0), NOW)).toBe("week");
    expect(bucketFor(at(2026, 7, 20, 12, 0), NOW)).toBe("month");
    expect(bucketFor(at(2026, 6, 1, 12, 0), NOW)).toBe("older");
  });

  it("sends a timestampless row to the bottom, not to 1970", () => {
    // Dating it to the epoch would sort it last anyway, but it would also
    // claim the conversation is decades old.
    expect(bucketFor(0, NOW)).toBe("older");
  });
});

describe("groupSessions", () => {
  const rows = [
    { id: "old", last_active: at(2026, 6, 1, 9, 0) },
    { id: "today-early", last_active: at(2026, 8, 2, 8, 0) },
    { id: "pinned-old", last_active: at(2026, 5, 1, 9, 0), pinned: true },
    { id: "yesterday", last_active: at(2026, 8, 1, 20, 0) },
    { id: "today-late", last_active: at(2026, 8, 2, 13, 0) },
  ];

  it("puts Đã ghim first, whatever its date", () => {
    const groups = groupSessions(rows, NOW);
    expect(groups[0].bucket).toBe("pinned");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["pinned-old"]);
  });

  it("shows a pinned session only once", () => {
    // Repeating it under its date bucket would lengthen the list without
    // adding anything.
    const ids = groupSessions(rows, NOW).flatMap((g) =>
      g.sessions.map((s) => s.id),
    );
    expect(ids.filter((id) => id === "pinned-old")).toHaveLength(1);
  });

  it("orders buckets newest-first and sorts inside them", () => {
    const groups = groupSessions(rows, NOW);
    expect(groups.map((g) => g.bucket)).toEqual([
      "pinned",
      "today",
      "yesterday",
      "older",
    ]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual([
      "today-late",
      "today-early",
    ]);
  });

  it("emits no empty groups", () => {
    const groups = groupSessions([rows[1]], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("today");
  });

  it("handles an empty list without inventing headings", () => {
    expect(groupSessions([], NOW)).toEqual([]);
  });
});

describe("applyPinOverrides", () => {
  const rows = [
    { id: "a", pinned: false },
    { id: "b", pinned: true },
  ];

  it("wins over a list page fetched before the write landed", () => {
    // A poll in flight when the PATCH returns carries the old flag and would
    // visibly un-pin the row the user just pinned.
    const applied = applyPinOverrides(rows, { a: true });
    expect(applied.find((r) => r.id === "a")?.pinned).toBe(true);
    expect(applied.find((r) => r.id === "b")?.pinned).toBe(true);
  });

  it("can force a row off as well as on", () => {
    expect(
      applyPinOverrides(rows, { b: false }).find((r) => r.id === "b")?.pinned,
    ).toBe(false);
  });

  it("returns the same array when there is nothing to override", () => {
    expect(applyPinOverrides(rows, {})).toBe(rows);
  });
});

describe("labels", () => {
  it("names each bucket", () => {
    expect(bucketLabelVi("pinned")).toBe("Đã ghim");
    expect(bucketLabelVi("today")).toBe("Hôm nay");
    expect(bucketLabelVi("yesterday")).toBe("Hôm qua");
  });

  it("says which way the click goes", () => {
    expect(pinActionVi(true)).toBe("Bỏ ghim");
    expect(pinActionVi(false)).toBe("Ghim lên đầu");
  });

  it("warns that the pin is shared with Desktop", () => {
    // sessions.pinned is gateway-wide, so this is not a Dashboard-only
    // bookmark and the user should not be surprised to see it there.
    expect(pinnedNoteVi()).toContain("Desktop");
  });

  it("counts pins", () => {
    expect(pinnedCount([{ id: "a", pinned: true }, { id: "b" }])).toBe(1);
  });
});
