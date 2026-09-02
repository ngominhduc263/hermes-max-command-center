import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  compressionsVi,
  contextAdviceVi,
  contextLabelVi,
  contextLevel,
  formatTokens,
  parseContextBreakdown,
  thresholdVi,
  type ContextBreakdown,
  type ContextUsage,
} from "@/lib/chat-context-usage";

interface ContextGaugeProps {
  usage: ContextUsage;
  /**
   * Fetches `session.context_breakdown`. Only called when the panel opens —
   * the gateway rebuilds the system prompt and estimates tokens over the whole
   * history to answer it, which is far too heavy to poll.
   */
  onBreakdown?: () => Promise<unknown>;
  /** Raw `/api/config`, for the configured compaction threshold. */
  config?: unknown;
}

/**
 * "Ngữ cảnh" — the context-window gauge for the chat toolbar.
 *
 * The chat could not answer the question that decides whether the next answer
 * will be any good: how full is the window. The terminal has `/context`; the
 * Dashboard had nothing, so the only way to find out was to leave the chat.
 *
 * Two things it deliberately does NOT do:
 *
 * - It never shows a number the gateway did not measure. Before the first turn
 *   there is no occupancy figure, and Hermes withholds the gauge on purpose for
 *   engines that cannot report one (#50421 was the bug where a lifetime token
 *   total got substituted and produced readings like 1.9m/120k). Unknown reads
 *   as "chưa đo được".
 * - It never claims to know when Hermes will compress. That trigger is resolved
 *   inside the agent through a chain the Dashboard cannot see; the panel shows
 *   the configured value, labelled as configured, and the count of compressions
 *   that have actually happened.
 */
export function ContextGauge({ usage, onBreakdown, config }: ContextGaugeProps) {
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const level = contextLevel(usage);
  const label = contextLabelVi(usage);

  const load = useCallback(() => {
    if (!onBreakdown) return;
    setLoading(true);
    onBreakdown()
      .then((payload) => setBreakdown(parseContextBreakdown(payload)))
      // The gauge itself is already on screen and correct; a failed breakdown
      // just means no detail table, never a broken toolbar.
      .catch(() => setBreakdown(null))
      .finally(() => setLoading(false));
  }, [onBreakdown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const threshold = thresholdVi(config);
  const widest = breakdown?.categories[0]?.tokens ?? 0;

  return (
    <div className="hermes-context-gauge" ref={panelRef}>
      <button
        type="button"
        className={cn("hermes-context-gauge-trigger", `is-${level}`)}
        aria-expanded={open}
        title="Mức đầy của cửa sổ ngữ cảnh"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !breakdown) load();
        }}
      >
        <Gauge className="h-4 w-4" />
        <span className="hermes-context-gauge-text">{label}</span>
        <span className="hermes-context-gauge-bar" aria-hidden="true">
          <span style={{ width: `${usage.percent ?? 0}%` }} />
        </span>
      </button>

      {open ? (
        <div
          className="hermes-context-gauge-panel"
          role="dialog"
          aria-label="Chi tiết ngữ cảnh"
        >
          <p className="hermes-context-gauge-advice">{contextAdviceVi(usage)}</p>

          {loading ? (
            <p className="hermes-context-gauge-loading">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Đang đo từng phần…
            </p>
          ) : breakdown?.categories.length ? (
            <>
              <h4>Ngữ cảnh đang chứa gì</h4>
              <ul className="hermes-context-gauge-rows">
                {breakdown.categories.map((category) => (
                  <li key={category.id}>
                    <span className="hermes-context-gauge-row-label">
                      {category.label}
                    </span>
                    <span className="hermes-context-gauge-row-bar" aria-hidden="true">
                      <span
                        style={{
                          background: category.color || undefined,
                          width: widest
                            ? `${Math.max(2, Math.round((category.tokens / widest) * 100))}%`
                            : "0%",
                        }}
                      />
                    </span>
                    <span className="hermes-context-gauge-row-tokens">
                      {formatTokens(category.tokens)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="hermes-context-gauge-note">
                Các con số từng phần là ước lượng của Hermes, nên cộng lại
                thường không khớp đúng tổng đo được ở trên.
              </p>
            </>
          ) : null}

          <p className="hermes-context-gauge-note">{compressionsVi(usage)}</p>
          {threshold ? (
            <p className="hermes-context-gauge-note">{threshold}</p>
          ) : null}

          <div className="hermes-context-gauge-commands">
            <p>
              <code>/compress</code> — nén ngay bây giờ (Hermes gọi là
              “compress”, không phải “compact”; <code>/compact</code> cũng chạy
              được vì là tên gọi khác của nó).
            </p>
            <p>
              <code>/compress here 10</code> — chỉ nén phần cũ, giữ nguyên 10
              lượt gần nhất.
            </p>
            <p>
              <code>/context</code> — bảng chi tiết đầy đủ trong tab Terminal.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
