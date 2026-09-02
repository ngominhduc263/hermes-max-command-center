import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Card } from "@nous-research/ui/ui/components/card";
import { Spinner } from "@nous-research/ui/ui/components/spinner";

import { api, type CronJob } from "@/lib/api";
import {
  cronHealthReport,
  cronHealthSummaryVi,
  type CronHealthReport,
} from "@/lib/cron-health";

/**
 * "Sức khoẻ lịch" — `hermes cron doctor` on screen.
 *
 * A scheduled job can stop working without anything looking wrong: the ticker
 * dies and `next_run_at` sits hours in the past while the job still reads
 * "enabled". v0.21.0 added a terminal check for exactly this; this page is the
 * same checks against the same fields, in Vietnamese, next to the jobs.
 *
 * Its own page rather than a banner bolted onto CronPage: that page belongs to
 * Hermes, and overwriting an upstream file to add a card is how the overlay
 * quietly reverts someone else's work (see v2.19.1's note about
 * `tools/approval.py`). Everything here is new files only.
 */
export default function CronHealthPage() {
  const [report, setReport] = useState<CronHealthReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    () =>
      api
        .getCronJobs("all")
        .then((jobs: CronJob[]) => {
          setReport(cronHealthReport(jobs));
          setError("");
        })
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : "không đọc được danh sách việc",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const healthy = report && !report.issueCount;

  return (
    <div className="hermes-cron-health flex flex-col gap-3">
      <Card className="px-4 py-3">
        <div className="hermes-cron-health-head">
          <div>
            <h2>
              <Clock className="h-4 w-4" /> Sức khoẻ lịch tác vụ
            </h2>
            <p>
              Việc đã hẹn giờ có thể hỏng mà nhìn vẫn như thường — hay gặp nhất
              là bộ hẹn giờ chết, giờ chạy kế tiếp nằm lì trong quá khứ mà việc
              vẫn hiện “đang bật”.
            </p>
          </div>
          <Button
            outlined
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            prefix={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Kiểm tra lại
          </Button>
        </div>
      </Card>

      {loading ? (
        <Card className="px-4 py-6">
          <div className="hermes-cron-health-loading">
            <Spinner /> Đang kiểm tra…
          </div>
        </Card>
      ) : error ? (
        <Card className="px-4 py-4">
          <p className="hermes-cron-health-error">
            <AlertCircle className="h-4 w-4" />
            Không đọc được danh sách việc ({error}).
          </p>
        </Card>
      ) : report ? (
        <>
          <Card
            className={`hermes-cron-health-summary px-4 py-3 ${
              healthy ? "is-ok" : "is-bad"
            }`}
          >
            {healthy ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            <strong>{cronHealthSummaryVi(report)}</strong>
          </Card>

          {report.unhealthy.map((job) => (
            <Card key={job.id} className="hermes-cron-health-job px-4 py-3">
              <div className="hermes-cron-health-job-head">
                <strong>{job.name}</strong>
                <code>{job.id}</code>
              </div>
              <ul>
                {job.issues.map((issue, index) => (
                  <li key={index} className={`is-${issue.level}`}>
                    <span>{issue.vi}</span>
                    {issue.fix ? <em>{issue.fix}</em> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          <Card className="hermes-cron-health-note px-4 py-3">
            <p>
              <Info className="h-3.5 w-3.5" />
              Hai mục dưới đây chỉ kiểm được từ terminal, vì trình duyệt không
              đọc được ổ đĩa của máy anh:
            </p>
            <ul>
              {report.skipped.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="hermes-cron-health-cmd">
              <Terminal className="h-3.5 w-3.5" />
              <code>hermes cron doctor</code> kiểm đủ cả sáu mục.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
