/**
 * "Ngữ cảnh" — how full the context window is, and who empties it.
 *
 * The chat had no answer to the one question that decides whether an answer
 * will still be any good: how much of the window is left. The terminal has
 * `/context` (a gauge plus a category table) and the TUI status bar shows the
 * same percentage; the Dashboard showed nothing at all.
 *
 * Nothing here computes token counts. The gateway already does that work and
 * hands it over in two places, and this module only reads what it says:
 *
 *   `session.usage` (tui_gateway/methods_session.py) and the `usage` object on
 *   every `message.complete` event, both built by `server.py::_get_usage`:
 *     {model, input, output, total, calls,
 *      context_used?, context_max?, context_percent?, compressions?,
 *      cache_hit_pct?, avg_tps?, active_subagents?}
 *
 *   `session.context_breakdown`, built by
 *   `agent/context_breakdown.py::compute_session_context_breakdown`:
 *     {categories: [{id, label, tokens, color}], context_used, context_max,
 *      context_percent, estimated_total, model}
 *
 * **The gauge is allowed to be unknown, and that matters.** `_get_usage` only
 * fills `context_used`/`context_percent` from a real current-occupancy figure;
 * an engine that does not track per-window occupancy, or a session before its
 * first turn, deliberately emits no gauge rather than a fabricated 0%. Hermes
 * fixed a bug (#50421) to stop substituting the lifetime token total there, so
 * inventing a number on this side would walk straight back into it. Absent
 * means "chưa đo được", never "0%".
 */

export interface ContextUsage {
  /** Tokens in the current window, when the gateway measured it. */
  used: number | null;
  /** Window size for the running model. */
  max: number | null;
  /** 0–100, as the gateway rounded it. */
  percent: number | null;
  /** Times this session has already been compressed. */
  compressions: number;
  model: string;
  /** Cumulative tokens for the session — not window occupancy. */
  totalTokens: number;
  apiCalls: number;
}

export const EMPTY_CONTEXT_USAGE: ContextUsage = {
  apiCalls: 0,
  compressions: 0,
  max: null,
  model: "",
  percent: null,
  totalTokens: 0,
  used: null,
};

export interface ContextCategory {
  id: string;
  /** Vietnamese label; falls back to the gateway's English one. */
  label: string;
  tokens: number;
  color: string;
}

export interface ContextBreakdown {
  categories: ContextCategory[];
  used: number | null;
  max: number | null;
  percent: number | null;
  /** The heuristic sum over categories — usually near, never equal to, `used`. */
  estimatedTotal: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A positive finite number, or null. Zero counts as "not measured" here. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Read the `usage` object from `session.usage` or from a `message.complete`
 * event. Both are the same shape — `_get_usage` builds both.
 */
export function parseContextUsage(raw: unknown): ContextUsage {
  const record = asRecord(raw);
  if (!record) return EMPTY_CONTEXT_USAGE;

  // `usage` may arrive wrapped in the event payload.
  const usage = asRecord(record.usage) ?? record;

  const used = positive(usage.context_used);
  const max = positive(usage.context_max);

  // The gateway sends all three together or none; recomputing the percent from
  // used/max would produce a gauge in cases where it deliberately withheld one.
  const percent =
    used !== null && max !== null
      ? typeof usage.context_percent === "number" &&
        Number.isFinite(usage.context_percent)
        ? Math.max(0, Math.min(100, Math.round(usage.context_percent)))
        : Math.max(0, Math.min(100, Math.round((used / max) * 100)))
      : null;

  return {
    apiCalls: count(usage.calls),
    compressions: count(usage.compressions),
    max,
    model: typeof usage.model === "string" ? usage.model : "",
    percent,
    totalTokens: count(usage.total),
    used,
  };
}

/** True when a payload carries a usable gauge. */
export function hasGauge(usage: ContextUsage): boolean {
  return usage.percent !== null && usage.max !== null;
}

/**
 * Keep the better of two readings.
 *
 * `message.complete` is the fresher source but a turn can end without a gauge
 * (an interrupted turn, an engine that does not report occupancy). Blanking a
 * good reading on every such turn would make the gauge flicker to "chưa đo
 * được" and back, so a measurement is only replaced by another measurement.
 * Counters that only ever grow (compressions, calls) take the larger value.
 */
export function mergeContextUsage(
  previous: ContextUsage,
  next: ContextUsage,
): ContextUsage {
  const measured = hasGauge(next);
  return {
    apiCalls: Math.max(previous.apiCalls, next.apiCalls),
    compressions: Math.max(previous.compressions, next.compressions),
    max: measured ? next.max : (next.max ?? previous.max),
    model: next.model || previous.model,
    percent: measured ? next.percent : previous.percent,
    totalTokens: Math.max(previous.totalTokens, next.totalTokens),
    used: measured ? next.used : previous.used,
  };
}

/** Vietnamese names for the categories `context_breakdown` reports. */
export const CONTEXT_CATEGORY_VI: Record<string, string> = {
  conversation: "Hội thoại",
  mcp: "Công cụ MCP",
  memory: "Bộ nhớ",
  rules: "Quy tắc",
  skills: "Danh mục kỹ năng",
  subagent_definitions: "Định nghĩa trợ lý phụ",
  system_prompt: "Lời nhắc hệ thống",
  tool_definitions: "Định nghĩa công cụ",
};

export function parseContextBreakdown(raw: unknown): ContextBreakdown {
  const record = asRecord(raw);
  if (!record) {
    return { categories: [], estimatedTotal: 0, max: null, percent: null, used: null };
  }

  const categories: ContextCategory[] = [];
  const rows = Array.isArray(record.categories) ? record.categories : [];
  for (const row of rows) {
    const entry = asRecord(row);
    if (!entry) continue;
    const id = typeof entry.id === "string" ? entry.id : "";
    const tokens = count(entry.tokens);
    if (!id || !tokens) continue;
    categories.push({
      color: typeof entry.color === "string" ? entry.color : "",
      id,
      label:
        CONTEXT_CATEGORY_VI[id] ??
        (typeof entry.label === "string" && entry.label ? entry.label : id),
      tokens,
    });
  }
  categories.sort((a, b) => b.tokens - a.tokens);

  const used = positive(record.context_used);
  const max = positive(record.context_max);

  return {
    categories,
    estimatedTotal: count(record.estimated_total),
    max,
    percent:
      used !== null && max !== null
        ? Math.max(0, Math.min(100, Math.round((used / max) * 100)))
        : null,
    used,
  };
}

/** `128500` → `"128,5k"`. Vietnamese decimal comma. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000;
    const text = thousands < 100 ? thousands.toFixed(1) : String(Math.round(thousands));
    return `${text.replace(".", ",").replace(",0", "")}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1).replace(".", ",")}tr`;
}

export type ContextLevel = "unknown" | "roomy" | "filling" | "full";

/**
 * Bands for colour only.
 *
 * These are NOT Hermes's compaction trigger. That trigger is resolved deep in
 * the agent (`_resolve_compression_threshold` → the small-window floor →
 * `_compute_threshold_tokens` → an optional absolute cap → a Codex autoraise),
 * none of which is exposed over any RPC, and re-deriving it in a browser would
 * be guesswork dressed as a number. The gauge shows what the gateway measured;
 * the configured threshold is shown separately, labelled as configured.
 */
export function contextLevel(usage: ContextUsage): ContextLevel {
  if (usage.percent === null) return "unknown";
  if (usage.percent >= 85) return "full";
  if (usage.percent >= 60) return "filling";
  return "roomy";
}

/** The one-line reading for the gauge itself. */
export function contextLabelVi(usage: ContextUsage): string {
  if (usage.percent === null || usage.used === null || usage.max === null) {
    return "Ngữ cảnh: chưa đo được";
  }
  return `${formatTokens(usage.used)}/${formatTokens(usage.max)} · ${usage.percent}%`;
}

/**
 * What this reading means, in a sentence.
 *
 * The point the user actually needs: Hermes compresses on its own. Someone
 * coming from another agent assumes a full window is their job to clear, and
 * watches the number climb wondering when to act.
 */
export function contextAdviceVi(usage: ContextUsage): string {
  if (usage.percent === null) {
    return "Hermes chưa báo số — thường phải xong một lượt trả lời thì mới đo được cửa sổ ngữ cảnh.";
  }
  if (usage.percent >= 85) {
    return "Gần đầy. Hermes sẽ tự nén khi chạm ngưỡng; muốn nén ngay thì gõ /compress.";
  }
  if (usage.percent >= 60) {
    return "Đang đầy dần, vẫn còn thoải mái. Hermes tự nén khi cần, anh không phải canh.";
  }
  return "Còn rộng.";
}

/** How many times Hermes has already tidied this session. */
export function compressionsVi(usage: ContextUsage): string {
  if (!usage.compressions) return "Phiên này chưa lần nào phải nén.";
  return `Hermes đã tự nén ${usage.compressions} lần trong phiên này.`;
}

/**
 * The configured compaction threshold, read from `compression.threshold`.
 *
 * Deliberately hedged. This is the value in the config file, and Hermes raises
 * it at runtime in cases the Dashboard cannot see: a raise-only floor of 75%
 * for models with windows under 512K, and a Codex autoraise to 85%. Printing
 * it bare as "Hermes nén ở 50%" would be wrong for almost every model, so it
 * is labelled as configured and says the effective value may be higher.
 */
export function thresholdVi(config: unknown): string {
  const record = asRecord(config);
  const compression = asRecord(record?.compression);
  const raw = compression?.threshold;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > 1) {
    return "";
  }
  return `Ngưỡng nén trong cấu hình: ${Math.round(raw * 100)}% (Hermes có thể tự nâng cao hơn với model có cửa sổ nhỏ).`;
}
