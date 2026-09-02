import { describe, expect, it } from "vitest";

import type { CronJob } from "./api";
import {
  cronHealthReport,
  cronHealthSummaryVi,
  cronJobIssues,
  isActiveJob,
  overdueVi,
  OVERDUE_GRACE_MS,
} from "./cron-health";

const NOW = Date.parse("2026-09-01T12:00:00Z");

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    enabled: true,
    id: "job-1",
    last_status: "ok",
    name: "Tóm tắt hằng ngày",
    next_run_at: new Date(NOW + 3600_000).toISOString(),
    ...overrides,
  } as CronJob;
}

describe("isActiveJob", () => {
  it("skips what the terminal check skips", () => {
    expect(isActiveJob(job())).toBe(true);
    expect(isActiveJob(job({ enabled: false }))).toBe(false);
    expect(isActiveJob(job({ state: "paused" }))).toBe(false);
    expect(isActiveJob(job({ state: "completed" }))).toBe(false);
    expect(isActiveJob(job({ state: "running" }))).toBe(true);
  });
});

describe("cronJobIssues", () => {
  it("says nothing about a healthy job", () => {
    expect(cronJobIssues(job(), NOW)).toEqual([]);
  });

  it("reports a failed run with its reason", () => {
    const issues = cronJobIssues(
      job({ last_error: "ConnectionError", last_status: "error" }),
      NOW,
    );
    expect(issues[0].vi).toContain("ConnectionError");
    expect(issues[0].level).toBe("error");
  });

  it("does not invent a reason when none was recorded", () => {
    const issues = cronJobIssues(job({ last_status: "failed" }), NOW);
    expect(issues[0].vi).toContain("không rõ lý do");
  });

  it("reports a delivery failure separately from a run failure", () => {
    const issues = cronJobIssues(
      job({ last_delivery_error: "channel gone", last_status: "error" }),
      NOW,
    );
    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.vi.includes("Gửi kết quả"))).toBe(true);
  });

  it("catches an active job with no next run at all", () => {
    const issues = cronJobIssues(job({ next_run_at: null }), NOW);
    expect(issues[0].vi).toContain("không bao giờ chạy");
  });

  it("catches the silent killer: a next run parked in the past", () => {
    // The ticker died; the job still looks enabled and nobody notices.
    const issues = cronJobIssues(
      job({ next_run_at: new Date(NOW - 5 * 3600_000).toISOString() }),
      NOW,
    );
    expect(issues[0].vi).toContain("đang đứng im");
    expect(issues[0].vi).toContain("5.0 giờ");
  });

  it("forgives a run that is only a little late", () => {
    // A busy tick can push dispatch a few minutes; same 15-minute grace the
    // terminal check uses.
    const late = new Date(NOW - (OVERDUE_GRACE_MS - 60_000)).toISOString();
    expect(cronJobIssues(job({ next_run_at: late }), NOW)).toEqual([]);
  });

  it("reports an unparseable timestamp rather than ignoring it", () => {
    const issues = cronJobIssues(job({ next_run_at: "chiều mai" }), NOW);
    expect(issues[0].vi).toContain("không đọc được");
  });

  it("catches a no-agent job with nothing to run", () => {
    const issues = cronJobIssues(job({ no_agent: true, script: null }), NOW);
    expect(issues[0].vi).toContain("không có script");
    expect(cronJobIssues(job({ no_agent: true, script: "x.py" }), NOW)).toEqual(
      [],
    );
  });

  it("does not check the schedule of a paused job", () => {
    // Paused means deliberately parked, so a stale next_run_at is expected.
    const parked = job({
      next_run_at: new Date(NOW - 99 * 3600_000).toISOString(),
      state: "paused",
    });
    expect(cronJobIssues(parked, NOW)).toEqual([]);
  });
});

describe("cronHealthReport", () => {
  it("counts only active jobs and puts the worst first", () => {
    const report = cronHealthReport(
      [
        job({ id: "ok" }),
        job({ id: "one-issue", last_status: "error" }),
        job({
          id: "two-issues",
          last_delivery_error: "boom",
          last_status: "error",
        }),
        job({ enabled: false, id: "off", last_status: "error" }),
      ],
      NOW,
    );
    expect(report.checked).toBe(3);
    expect(report.issueCount).toBe(3);
    expect(report.unhealthy.map((entry) => entry.id)).toEqual([
      "two-issues",
      "one-issue",
    ]);
  });

  it("names an unnamed job rather than showing a blank", () => {
    const report = cronHealthReport([job({ last_status: "error", name: "" })], NOW);
    expect(report.unhealthy[0].name).toBe("(chưa đặt tên)");
  });

  it("is honest about the two checks a browser cannot run", () => {
    const report = cronHealthReport([job()], NOW);
    expect(report.skipped).toHaveLength(2);
    expect(report.skipped.join(" ")).toContain("script");
    expect(report.skipped.join(" ")).toContain("workdir");
  });

  it("copes with no jobs at all", () => {
    expect(cronHealthReport([], NOW).checked).toBe(0);
    expect(cronHealthReport(null, NOW).unhealthy).toEqual([]);
    expect(cronHealthReport(undefined, NOW).issueCount).toBe(0);
  });
});

describe("cronHealthSummaryVi", () => {
  it("says the healthy case plainly", () => {
    expect(cronHealthSummaryVi(cronHealthReport([job()], NOW))).toContain(
      "đều bình thường",
    );
  });

  it("counts problems and the jobs they belong to", () => {
    const report = cronHealthReport([job({ last_status: "error" }), job()], NOW);
    expect(cronHealthSummaryVi(report)).toBe("1 vấn đề ở 1/2 việc đang bật.");
  });

  it("says so when nothing is scheduled", () => {
    expect(cronHealthSummaryVi(cronHealthReport([], NOW))).toContain(
      "Chưa có việc nào",
    );
  });
});

describe("overdueVi", () => {
  it("scales the unit to the gap", () => {
    expect(overdueVi(20 * 60_000)).toBe("20 phút");
    expect(overdueVi(3 * 3600_000)).toBe("3.0 giờ");
    expect(overdueVi(72 * 3600_000)).toBe("3 ngày");
  });
});
