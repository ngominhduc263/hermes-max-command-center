/**
 * The turn-level controls: hỏi thêm, nén, lùi một lượt, tách nhánh, lái lượt.
 *
 * Every one of these was read off the gateway before it was built, because
 * each has at least one behaviour its name does not imply. The notes below are
 * the ones that change what the buttons may promise.
 *
 * ── `prompt.btw` — hỏi thêm một câu, không đụng vào hội thoại ───────────
 *
 * Not "queue a question for later". It snapshots the live conversation and
 * runs a **separate one-shot call against that snapshot**: the session's
 * history, role alternation and prompt cache are untouched. Answer arrives as
 * `btw.complete {task_id, question, text}` on the parent session's stream.
 *
 * ── `prompt.background` — a FRESH session with no context ───────────────
 *
 * This is the one whose name misleads. It does not run your conversation in
 * the background; it builds a brand-new agent with `session_id = task_id` and
 * **no parent history seeded at all**. So it is only useful for a question
 * that stands on its own, and the UI must say so — hence `backgroundNoteVi`.
 * Answer arrives as `background.complete {task_id, text}`.
 *
 * Both return immediately with a task id and then report failures **inside the
 * completion event text** as a literal `error: …` prefix — the RPC already
 * said ok. `sideAnswerFailed` is that sniff, and it exists because there is no
 * status field to read instead.
 *
 * ── `session.compress` — irreversible, and it rotates the session key ───
 *
 * Summarises and replaces history, ends the DB session and starts a
 * continuation. There is no uncompress and no undo: `session.undo` afterwards
 * rewinds the *summary*, not the turns it replaced. Requires an idle session
 * (4009 while running) and quietly does nothing under 4 messages.
 *
 * It answers in four different shapes, and only one of them has a `status`
 * key — a UI keying on `status` alone reads `undefined` on a held lock. Three
 * of the five `summary.headline` branches are failure-ish while still coming
 * back as ok, which is why `compressOutcome` renders the server's own
 * headline instead of deriving text from the counts.
 *
 * ── `session.undo` — exactly one exchange, files untouched ──────────────
 *
 * Takes **no count parameter**. The slash catalog advertises `/undo [N]`, but
 * that is the standalone CLI; the gateway RPC undoes one user-originated turn
 * and its tail, returning `{removed}` — a count of rows, not of turns. It
 * never touches files the agent wrote, so the button says so.
 *
 * ── `session.branch` — a real child session ─────────────────────────────
 *
 * Copies the transcript into a new session with `parent_session_id` set and
 * `model_config._branched_from` recorded. Note it has **no busy guard**, so
 * branching mid-turn forks a partial turn; this module gates on that instead.
 *
 * ── `session.steer` / `session.redirect` — the footgun ──────────────────
 *
 * `session.redirect` checks for a live turn and answers `rejected` when there
 * is none. `session.steer` does **not**: it succeeds on an idle session and
 * the text then silently rides along inside the next turn's first tool batch.
 * That is a genuine trap, so `steerProblemVi` refuses it client-side unless a
 * turn is actually running. Neither emits any event, so the UI has to render
 * what it sent optimistically.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/* ── Side questions ─────────────────────────────────────────────────── */

export interface SideAnswer {
  taskId: string;
  /** `btw` echoes the question back; `background` does not. */
  question: string;
  text: string;
  kind: "btw" | "background";
  failed: boolean;
}

/**
 * Both handlers catch their own exceptions and deliver the failure as the
 * answer text with an `error: ` prefix, having already returned ok. Sniffing
 * the prefix is the only way to tell a failure from an answer.
 */
export function sideAnswerFailed(text: string): boolean {
  return /^error:/i.test(text.trim());
}

/** Read a `btw.complete` or `background.complete` payload. */
export function parseSideAnswer(
  kind: "btw" | "background",
  raw: unknown,
): SideAnswer | null {
  const record = asRecord(raw);
  if (!record) return null;
  const taskId = str(record.task_id).trim();
  if (!taskId) return null;
  const text = str(record.text);
  return {
    failed: sideAnswerFailed(text),
    kind,
    question: str(record.question),
    taskId,
    text,
  };
}

/** The task id a side question returned, or "" when the call gave none. */
export function parseSideTaskId(raw: unknown): string {
  return str(asRecord(raw)?.task_id).trim();
}

/**
 * The warning that has to sit next to the background button.
 *
 * Without it "hỏi nền" reads as "ask about this, in the background", which is
 * the opposite of what it does.
 */
export function backgroundNoteVi(): string {
  return "Câu hỏi nền chạy trong một phiên MỚI, không thấy nội dung cuộc trò chuyện này — hỏi câu đứng độc lập được thôi.";
}

/** And the one next to "hỏi thêm", which is the context-aware option. */
export function btwNoteVi(): string {
  return "Hỏi thêm đọc được toàn bộ cuộc trò chuyện, nhưng không ghi gì vào đó — hỏi xong hội thoại vẫn y nguyên.";
}

/* ── Compress ───────────────────────────────────────────────────────── */

export interface CompressOutcome {
  /** True when history really changed. */
  changed: boolean;
  /** Hermes's own headline — never re-derived from the counts. */
  headline: string;
  tokenLine: string;
  note: string;
  /** The lock-held shape, which carries no `status` at all. */
  lockHeld: boolean;
  beforeMessages: number | null;
  afterMessages: number | null;
}

/**
 * Read a `session.compress` reply in any of its four shapes.
 *
 * The counts alone cannot tell "refused because the summary would grow the
 * conversation" from "nothing to do", so the server's `summary.headline` is
 * what gets shown.
 */
export function parseCompressOutcome(raw: unknown): CompressOutcome {
  const record = asRecord(raw);
  const summary = asRecord(record?.summary);

  // The held-lock reply uses `compressed: false` and has no `status` key.
  const lockHeld = record?.lock_held === true;
  const status = str(record?.status);
  const removed = int(record?.removed) ?? 0;

  const headline =
    str(summary?.headline).trim() ||
    (lockHeld
      ? "Một tiến trình nén khác đang chạy — thử lại sau."
      : status === "aborted"
        ? "Nén bị huỷ giữa chừng."
        : removed > 0
          ? `Đã nén, bỏ bớt ${removed} tin.`
          : "Không có gì để nén.");

  return {
    afterMessages: int(record?.after_messages),
    beforeMessages: int(record?.before_messages),
    changed: !lockHeld && status === "compressed" && removed > 0,
    headline,
    lockHeld,
    note: str(summary?.note).trim(),
    tokenLine: str(summary?.token_line).trim(),
  };
}

/** Why compress cannot run right now, or "". */
export function compressProblemVi(running: boolean): string {
  // The gateway answers 4009 while a turn is running; saying so first is
  // kinder than surfacing the raw error.
  return running ? "Đang chạy một lượt — dừng lượt đó trước khi nén." : "";
}

/** The confirm text. Compress has no undo, so this must not undersell it. */
export function compressConfirmVi(): string {
  return "Nén hội thoại? Hermes sẽ tóm tắt phần cũ và thay thế nó — KHÔNG hoàn tác được, và /undo sau đó chỉ lùi được phần tóm tắt.";
}

/* ── Undo ───────────────────────────────────────────────────────────── */

/** Rows removed by `session.undo` — a row count, not a turn count. */
export function parseUndoRemoved(raw: unknown): number {
  return int(asRecord(raw)?.removed) ?? 0;
}

export function undoResultVi(removed: number): string {
  if (removed <= 0) return "Không có lượt nào để lùi.";
  return `Đã lùi 1 lượt (bỏ ${removed} tin). File Hermes đã ghi thì vẫn còn nguyên.`;
}

export function undoProblemVi(running: boolean): string {
  return running ? "Đang chạy một lượt — dừng lượt đó trước khi lùi." : "";
}

/* ── Branch ─────────────────────────────────────────────────────────── */

export interface BranchResult {
  sessionId: string;
  storedSessionId: string;
  title: string;
  parent: string;
  messageCount: number;
}

export function parseBranchResult(raw: unknown): BranchResult | null {
  const record = asRecord(raw);
  const sessionId = str(record?.session_id).trim();
  if (!sessionId) return null;
  return {
    messageCount: int(record?.message_count) ?? 0,
    parent: str(record?.parent).trim(),
    sessionId,
    storedSessionId: str(record?.stored_session_id).trim(),
    title: str(record?.title).trim(),
  };
}

/**
 * `session.branch` has no busy guard of its own, so branching mid-turn forks a
 * half-finished turn. The gateway will not stop it; this does.
 */
export function branchProblemVi(running: boolean, hasHistory: boolean): string {
  if (running) return "Đang chạy một lượt — nhánh tách lúc này sẽ dính nửa lượt.";
  if (!hasHistory) return "Chưa có tin nhắn nào để tách nhánh.";
  return "";
}

export function branchResultVi(result: BranchResult): string {
  return `Đã tách nhánh "${result.title || result.storedSessionId}" với ${result.messageCount} tin. Bản gốc vẫn còn nguyên.`;
}

/* ── Steer / redirect ───────────────────────────────────────────────── */

export type SteerMode = "steer" | "redirect";

/**
 * Why this cannot be sent, or "".
 *
 * The `running` check is not cosmetic for steer: the gateway accepts a steer
 * on an idle session, answers `queued`, and the text then appears inside the
 * next turn's tool results with nothing in the transcript to explain it. The
 * user would have no idea where it went.
 */
export function steerProblemVi(
  mode: SteerMode,
  text: string,
  running: boolean,
): string {
  if (!text.trim()) return "Chưa nhập nội dung.";
  if (!running) {
    return mode === "steer"
      ? "Chỉ lái được khi Hermes đang chạy — lúc rảnh thì cứ nhắn bình thường."
      : "Không có lượt nào đang chạy — cứ nhắn bình thường.";
  }
  return "";
}

/** What the gateway said it did with the text. */
export function steerStatusVi(mode: SteerMode, raw: unknown): string {
  const status = str(asRecord(raw)?.status);
  if (status === "redirected") {
    // Note: while tools are executing, Hermes downgrades a redirect to a
    // steer and still answers "redirected". There is no field that tells us
    // which happened, so the wording avoids promising the turn was cut.
    return "Đã chen lời — Hermes sẽ đổi hướng ở bước kế tiếp.";
  }
  if (status === "queued") {
    return mode === "redirect"
      ? "Lượt chưa kịp chạy — câu này thành lượt kế tiếp."
      : "Đã gửi — Hermes sẽ đọc ở nhóm công cụ kế tiếp.";
  }
  if (status === "rejected") {
    return "Lượt vừa kết thúc trước khi câu này tới — cứ nhắn bình thường.";
  }
  return "Đã gửi.";
}

/** Short explanation of the two modes, for the control's own help line. */
export function steerModeNoteVi(mode: SteerMode): string {
  return mode === "steer"
    ? "Lái: nhắc thêm mà không cắt ngang — Hermes đọc được ở nhóm công cụ kế tiếp."
    : "Đổi hướng: cắt câu trả lời đang viết dở và đi theo hướng mới ngay.";
}
