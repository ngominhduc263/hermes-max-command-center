/**
 * Checkpoints — xem, so sánh, và (rất cẩn thận) khôi phục.
 *
 * A checkpoint is a git commit in a shared shadow repo, taken automatically
 * **before a file-writing tool runs** (`write_file`, `patch`, or a destructive
 * `terminal` command), at most once per directory per agent iteration. So they
 * do not line up with conversation turns: a turn that only read files or chatted
 * produces none.
 *
 * Four things about this feature would mislead a user if the UI stayed quiet,
 * and each is handled below rather than papered over.
 *
 * ── 1. It is off by default in the gateway the Dashboard drives ─────────
 *
 * The TUI gateway reads `HERMES_TUI_CHECKPOINTS` from the environment and
 * **ignores `checkpoints.enabled` in config.yaml** (the CLI and messaging
 * gateway both read config; this one does not). The Dashboard's PTY spawn
 * never sets that variable, so `rollback.list` normally answers
 * `{enabled: false}`. A panel that just rendered "no checkpoints" would look
 * broken; `disabledNoteVi` says what is actually true and how to change it.
 *
 * ── 2. The label is always empty ────────────────────────────────────────
 *
 * `CheckpointManager` records why each snapshot was taken under `reason`, but
 * the RPC copies `c.get("message", "")` — a key the manager never emits — so
 * every checkpoint arrives with `message: ""`. The RPC also drops
 * `short_hash`, `files_changed`, `insertions` and `deletions`, all of which
 * the manager computes. Nothing here can recover them, so the list shows the
 * time and the short hash and does not pretend to a description.
 *
 * ── 3. The diff is silently truncated, and errors look like "no changes" ─
 *
 * The RPC slices the diff to 4000 characters with no marker and no flag, and
 * discards the manager's `success`/`error` — so a bad hash comes back as an
 * empty diff, indistinguishable from a clean tree. `diffLooksTruncated` flags
 * the first; the empty case is labelled as ambiguous rather than as "no
 * changes", because it genuinely is.
 *
 * ── 4. Restore is more destructive than its name ────────────────────────
 *
 * Two things a "roll back" button would not lead you to expect:
 *
 * - The gateway calls `restore(..., safe=False)`. The messaging gateway opts
 *   into `safe=True`, which consults the agent-write ledger and refuses to
 *   clobber files you edited by hand. This path does not: it runs
 *   `git checkout <hash> -- .` over the whole tree and **overwrites your own
 *   edits**. (The Dashboard's baked slash-command help claims the opposite;
 *   that text describes the messaging gateway.)
 * - A whole-tree restore also rewinds the conversation — but only ever by
 *   **one** exchange, `len(user_indices) - 1`, regardless of which checkpoint
 *   you picked. Restoring to the twelfth checkpoint back moves the files
 *   twelve snapshots and the transcript one.
 *
 * Restoring a single file avoids the history rewind entirely, so the panel
 * offers that as the calm option. Hermes does take a "pre-rollback snapshot"
 * first, so the files themselves can be recovered; the dropped exchange
 * cannot.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The hard slice the RPC applies to every diff, with no marker. */
export const DIFF_TRUNCATE_CHARS = 4000;

export interface Checkpoint {
  hash: string;
  /** Server-formatted timestamp; the only human label that survives. */
  timestamp: string;
  /** First 8 of the hash — built here, because the RPC drops `short_hash`. */
  shortHash: string;
}

export interface CheckpointList {
  enabled: boolean;
  checkpoints: Checkpoint[];
}

/** Read a `rollback.list` reply. */
export function parseCheckpoints(raw: unknown): CheckpointList {
  const record = asRecord(raw);
  if (!record || record.enabled !== true) {
    return { checkpoints: [], enabled: false };
  }
  const rows = Array.isArray(record.checkpoints) ? record.checkpoints : [];
  const checkpoints: Checkpoint[] = [];
  for (const row of rows) {
    const entry = asRecord(row);
    const hash = str(entry?.hash).trim();
    if (!hash) continue;
    checkpoints.push({
      hash,
      shortHash: hash.slice(0, 8),
      timestamp: str(entry?.timestamp).trim(),
    });
  }
  return { checkpoints, enabled: true };
}

/**
 * What to say when the feature is off — which is the default here.
 *
 * Naming the environment variable matters: the obvious fix, setting
 * `checkpoints.enabled` in config.yaml, has no effect on this gateway.
 */
export function disabledNoteVi(): string {
  return "Checkpoint đang tắt. Gateway của Dashboard chỉ bật khi có biến môi trường HERMES_TUI_CHECKPOINTS=1 — đặt `checkpoints.enabled` trong config.yaml KHÔNG có tác dụng ở đây.";
}

export interface RollbackDiff {
  stat: string;
  diff: string;
  /** The reply hit the 4000-char slice, so this is only the beginning. */
  truncated: boolean;
  /** Empty diff: either nothing changed, or the request failed silently. */
  ambiguousEmpty: boolean;
}

/** Read a `rollback.diff` reply. */
export function parseRollbackDiff(raw: unknown): RollbackDiff {
  const record = asRecord(raw);
  const diff = str(record?.diff);
  const stat = str(record?.stat);
  return {
    ambiguousEmpty: !diff.trim() && !stat.trim(),
    diff,
    stat,
    truncated: diffLooksTruncated(diff),
  };
}

/**
 * Did the 4000-char slice bite?
 *
 * There is no flag, so length is the only signal available. A diff that
 * lands exactly on the boundary is treated as truncated: over-warning costs
 * a sentence, under-warning hides missing changes.
 */
export function diffLooksTruncated(diff: string): boolean {
  return diff.length >= DIFF_TRUNCATE_CHARS;
}

/** What an empty diff really means here. */
export function emptyDiffNoteVi(): string {
  return "Không có nội dung trả về. Có thể là không có gì thay đổi, mà cũng có thể là checkpoint không đọc được — RPC này nuốt lỗi nên không phân biệt được.";
}

export function truncatedNoteVi(): string {
  return `Diff bị cắt ở ${DIFF_TRUNCATE_CHARS} ký tự (giới hạn cứng của RPC, không có dấu báo) — phần dưới không hiện ra ở đây.`;
}

/** The file paths a unified diff mentions, best-effort. */
export function filesInDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = line.match(/^\+\+\+ b\/(.+)$/);
    if (!match) continue;
    const path = match[1].trim();
    if (path && path !== "/dev/null" && !files.includes(path)) files.push(path);
  }
  return files;
}

export interface RestoreResult {
  success: boolean;
  restoredTo: string;
  error: string;
  /** Present only on a whole-tree restore. Always at most one exchange. */
  historyRemoved: number;
  file: string;
}

/**
 * Read a `rollback.restore` reply.
 *
 * A failed restore still comes back as JSON-RPC success with
 * `{success: false}` in the body, so the flag has to be read explicitly.
 */
export function parseRestoreResult(raw: unknown): RestoreResult {
  const record = asRecord(raw);
  const removed = record?.history_removed;
  return {
    error: str(record?.error),
    file: str(record?.file),
    historyRemoved:
      typeof removed === "number" && Number.isFinite(removed)
        ? Math.round(removed)
        : 0,
    restoredTo: str(record?.restored_to),
    success: record?.success === true,
  };
}

/**
 * The confirm text, which has to carry both surprises.
 *
 * `filePath` given → files only, no history touched, much calmer wording.
 */
export function restoreConfirmVi(shortHash: string, filePath?: string): string {
  if (filePath?.trim()) {
    return `Khôi phục riêng "${filePath.trim()}" về checkpoint ${shortHash}? Chỉ file này bị ghi đè — kể cả phần anh tự sửa tay. Hội thoại không bị đụng tới.`;
  }
  return `Khôi phục TOÀN BỘ thư mục về checkpoint ${shortHash}?\n\n• Ghi đè mọi file theo checkpoint, KỂ CẢ chỗ anh tự sửa tay sau đó (đường này của Hermes không bật chế độ an toàn).\n• Xoá đúng 1 lượt hội thoại cuối — bất kể anh chọn checkpoint nào.\n\nHermes có chụp một checkpoint trước khi khôi phục nên file lấy lại được; lượt hội thoại thì không.`;
}

export function restoreResultVi(result: RestoreResult): string {
  if (!result.success) {
    return result.error
      ? `Khôi phục thất bại: ${result.error}`
      : "Khôi phục thất bại.";
  }
  if (result.file) {
    return `Đã khôi phục ${result.file} về ${result.restoredTo}.`;
  }
  const tail =
    result.historyRemoved > 0
      ? ` và bỏ ${result.historyRemoved} tin khỏi hội thoại`
      : "";
  return `Đã khôi phục thư mục về ${result.restoredTo}${tail}.`;
}

/**
 * Checkpoints belong to a working directory, not a session.
 *
 * Two sessions open in the same folder share one list and can restore over
 * each other, which is worth one line in the panel.
 */
export function scopeNoteVi(): string {
  return "Checkpoint gắn với THƯ MỤC làm việc, không phải phiên chat — hai phiên cùng thư mục dùng chung danh sách này.";
}
