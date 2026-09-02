/**
 * `hermes cron doctor`, ported to the Dashboard.
 *
 * Hermes v0.21.0 added a read-only health check for scheduled jobs, because a
 * job can quietly stop working in ways `cron list` does not shout about: the
 * script moved, delivery started failing, or — the nastiest one — the ticker
 * died and `next_run_at` is parked hours in the past while the job still looks
 * "enabled". You would never notice until you wondered why the digest stopped
 * arriving.
 *
 * That check only exists in the terminal. This is the same logic against the
 * same fields (`hermes_cli/cron.py::_cron_doctor_issues_for_job`), in
 * Vietnamese, so the answer is on screen next to the jobs themselves.
 *
 * Two of the terminal's six checks need the filesystem — whether the script
 * file exists, whether the workdir exists — and a browser cannot look. Those
 * are reported as "chỉ terminal kiểm được" rather than silently dropped, so
 * this never reads as a clean bill of health it did not actually give.
 */

import type { CronJob } from "./api";

export type CronIssueLevel = "error" | "warn";

export interface CronIssue {
  level: CronIssueLevel;
  /** What is wrong, in Vietnamese. */
  vi: string;
  /** What to do about it. */
  fix?: string;
}

export interface CronJobHealth {
  id: string;
  name: string;
  issues: CronIssue[];
}

export interface CronHealthReport {
  /** Jobs with at least one issue, worst first. */
  unhealthy: CronJobHealth[];
  /** Active jobs examined. */
  checked: number;
  issueCount: number;
  /** Checks a browser cannot run — named so the report stays honest. */
  skipped: string[];
}

/**
 * The ticker runs once a minute and a busy tick can push dispatch a few
 * minutes late; only a `next_run_at` parked well in the past means the job is
 * genuinely not firing. Same 15 minutes the terminal check uses.
 */
export const OVERDUE_GRACE_MS = 15 * 60 * 1000;

const SKIPPED_CHECKS = [
  "File script có tồn tại và có nằm trong thư mục scripts không",
  "Thư mục làm việc (workdir) có tồn tại không",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** How long ago, in Vietnamese, for a millisecond gap. */
export function overdueVi(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = ms / 3600000;
  if (hours < 48) return `${hours.toFixed(1)} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

/**
 * A job is due to be examined when it is enabled and not deliberately parked.
 * Matches `list_jobs(include_disabled=False)` plus the paused/completed skip.
 */
export function isActiveJob(job: CronJob): boolean {
  if (job.enabled === false) return false;
  const state = text(job.state).toLowerCase();
  return state !== "paused" && state !== "completed";
}

/** Everything wrong with one job. Empty means healthy. */
export function cronJobIssues(job: CronJob, now: number = Date.now()): CronIssue[] {
  const issues: CronIssue[] = [];

  const lastStatus = text(job.last_status).toLowerCase();
  if (lastStatus && lastStatus !== "ok") {
    issues.push({
      fix: "Xem nhật ký của việc này để biết vì sao.",
      level: "error",
      vi: `Lần chạy gần nhất thất bại: ${text(job.last_error) || "không rõ lý do"}`,
    });
  }

  const deliveryError = text(job.last_delivery_error);
  if (deliveryError) {
    issues.push({
      fix: "Kiểm tra nơi nhận kết quả (kênh/chat) còn hoạt động không.",
      level: "error",
      vi: `Gửi kết quả thất bại: ${deliveryError}`,
    });
  }

  if (isActiveJob(job)) {
    const nextRun = text(job.next_run_at);
    if (!nextRun) {
      issues.push({
        fix: "Tạm dừng rồi bật lại việc này để nó tính lại giờ chạy.",
        level: "error",
        vi: "Việc đang bật nhưng không có giờ chạy kế tiếp — nó sẽ không bao giờ chạy.",
      });
    } else {
      const at = Date.parse(nextRun);
      if (Number.isNaN(at)) {
        issues.push({
          level: "error",
          vi: `Giờ chạy kế tiếp không đọc được: "${nextRun}"`,
        });
      } else if (now - at > OVERDUE_GRACE_MS) {
        issues.push({
          fix: "Bộ hẹn giờ có thể đã chết — thử khởi động lại Gateway.",
          level: "error",
          vi: `Đã quá giờ chạy ${overdueVi(now - at)} mà chưa chạy — việc này đang đứng im.`,
        });
      }
    }
  }

  if (job.no_agent && !text(job.script)) {
    issues.push({
      fix: "Thêm script, hoặc tắt chế độ no-agent.",
      level: "error",
      vi: "Chạy ở chế độ không dùng agent nhưng lại không có script nào để chạy.",
    });
  }

  return issues;
}

/** Health across every active job, worst first. */
export function cronHealthReport(
  jobs: CronJob[] | null | undefined,
  now: number = Date.now(),
): CronHealthReport {
  const active = (jobs ?? []).filter(isActiveJob);
  const unhealthy: CronJobHealth[] = [];

  for (const job of active) {
    const issues = cronJobIssues(job, now);
    if (!issues.length) continue;
    unhealthy.push({
      id: text(job.id) || "?",
      issues,
      name: text(job.name) || "(chưa đặt tên)",
    });
  }

  // Most broken first; ties keep the order the API returned.
  unhealthy.sort((a, b) => b.issues.length - a.issues.length);

  return {
    checked: active.length,
    issueCount: unhealthy.reduce((total, job) => total + job.issues.length, 0),
    skipped: SKIPPED_CHECKS,
    unhealthy,
  };
}

/** One line summarising the report, for a badge or a heading. */
export function cronHealthSummaryVi(report: CronHealthReport): string {
  if (!report.checked) return "Chưa có việc nào đang bật.";
  if (!report.issueCount) {
    return `Cả ${report.checked} việc đang bật đều bình thường.`;
  }
  return `${report.issueCount} vấn đề ở ${report.unhealthy.length}/${report.checked} việc đang bật.`;
}
