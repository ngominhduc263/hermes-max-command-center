/**
 * The git indicator under the composer — `main ↑233 ↓1 +27737 −118`.
 *
 * Hermes Desktop shows this and the web Dashboard did not, which is a real
 * gap: while you are telling an agent to change files, "how far has this repo
 * drifted" is exactly the thing you want in view, and going to a terminal to
 * find out breaks the loop.
 *
 * ── Where the numbers come from ─────────────────────────────────────────
 *
 * `GET /api/git/status?path=<abs dir>`, which is the **same endpoint the
 * Desktop app calls** (`apps/desktop/src/lib/desktop-git.ts` →
 * `gitGet('status', {path})`). Nothing here is derived or estimated:
 *
 *     {branch, defaultBranch, detached, ahead, behind,
 *      staged, unstaged, untracked, conflicted, changed,
 *      added, removed, files[]}
 *
 * `ahead`/`behind` come from `git status --porcelain=v2 --branch`'s
 * `# branch.ab` record, so they are **0/0 when the branch has no upstream** —
 * which is not the same as "in sync". The formatter therefore hides them at
 * zero rather than drawing `↑0 ↓0`, because a zero here means "nothing to
 * say", not "up to date".
 *
 * ── Two things the endpoint does that a caller must handle ──────────────
 *
 * - It answers **JSON `null`**, not a 404, when the path is not a directory
 *   or `git status` fails. So a non-repo working directory is a successful
 *   response containing nothing, and the indicator simply does not render.
 * - It is **poll-only**. There is no push event for working-tree changes
 *   anywhere in Hermes; Desktop polls on turn-settle, tool-complete and
 *   window-focus edges. This module exposes the same trigger points rather
 *   than inventing a timer that runs while nothing is happening.
 */

export interface GitStatus {
  branch: string;
  detached: boolean;
  ahead: number;
  behind: number;
  /** Lines added versus HEAD, untracked files included. */
  added: number;
  removed: number;
  /** How many files differ in any way. */
  changed: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Read `/api/git/status`.
 *
 * Returns null for the "not a repo" answer, which arrives as a successful
 * response with a null body rather than an error.
 */
export function parseGitStatus(raw: unknown): GitStatus | null {
  const record = asRecord(raw);
  if (!record) return null;
  const branch = typeof record.branch === "string" ? record.branch.trim() : "";
  const detached = record.detached === true;
  // A detached HEAD has no branch name; anything else with no branch is not a
  // repository answer worth drawing.
  if (!branch && !detached) return null;
  return {
    added: count(record.added),
    ahead: count(record.ahead),
    behind: count(record.behind),
    branch,
    changed: count(record.changed),
    conflicted: count(record.conflicted),
    detached,
    removed: count(record.removed),
    staged: count(record.staged),
    unstaged: count(record.unstaged),
    untracked: count(record.untracked),
  };
}

/** The branch label, or `HEAD rời` for a detached checkout. */
export function branchLabelVi(status: GitStatus): string {
  if (status.detached) return status.branch || "HEAD rời";
  return status.branch;
}

/**
 * Is there anything worth drawing beyond the branch name?
 *
 * A clean repo on an up-to-date branch should render as just the name, not a
 * row of zeros.
 */
export function hasChanges(status: GitStatus): boolean {
  return (
    status.ahead > 0 ||
    status.behind > 0 ||
    status.added > 0 ||
    status.removed > 0 ||
    status.changed > 0
  );
}

/** `↑233 ↓1` — omitted entirely at zero, because zero here means "unknown". */
export function syncLabel(status: GitStatus): string {
  const parts: string[] = [];
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  return parts.join(" ");
}

/** `+27737 −118`, using a real minus sign so it cannot read as a hyphen. */
export function diffLabel(status: GitStatus): string {
  const parts: string[] = [];
  if (status.added > 0) parts.push(`+${status.added}`);
  if (status.removed > 0) parts.push(`−${status.removed}`);
  return parts.join(" ");
}

/**
 * The whole line, for a tooltip and for screen readers.
 *
 * Spelled out rather than symbolic: `↑` and `↓` are not self-explanatory, and
 * this is the only place the meaning can be stated.
 */
export function summaryVi(status: GitStatus): string {
  const parts = [`Nhánh ${branchLabelVi(status)}`];
  if (status.ahead > 0) parts.push(`đi trước ${status.ahead} commit`);
  if (status.behind > 0) parts.push(`đi sau ${status.behind} commit`);
  if (status.ahead === 0 && status.behind === 0) {
    // Deliberately not "đã đồng bộ": with no upstream the endpoint also
    // reports 0/0, and claiming "in sync" would be a guess.
    parts.push("chưa so được với remote (hoặc không lệch commit nào)");
  }
  if (status.changed > 0) parts.push(`${status.changed} file thay đổi`);
  if (status.added > 0 || status.removed > 0) {
    parts.push(`+${status.added} −${status.removed} dòng`);
  }
  if (status.conflicted > 0) parts.push(`${status.conflicted} file xung đột`);
  if (!hasChanges(status)) parts.push("cây làm việc sạch");
  return parts.join(" · ");
}

/**
 * Why the status could not be shown, in Vietnamese, or "" when it can.
 *
 * The empty-cwd case is separated from the not-a-repo case because they call
 * for different things from the user.
 */
export function unavailableReasonVi(cwd: string, status: GitStatus | null): string {
  if (!cwd.trim()) return "Chưa biết thư mục làm việc của phiên này.";
  if (!status) return "Thư mục này không phải kho git.";
  return "";
}
