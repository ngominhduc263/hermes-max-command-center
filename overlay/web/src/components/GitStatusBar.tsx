import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  branchLabelVi,
  diffLabel,
  hasChanges,
  parseGitStatus,
  summaryVi,
  syncLabel,
  type GitStatus,
} from "@/lib/git-status";

interface GitStatusBarProps {
  /** The session's working directory. Empty means nothing to show. */
  cwd: string;
  /**
   * Bumped by the caller when a turn settles or a tool finishes — the moments
   * the working tree is most likely to have changed.
   */
  refreshKey?: number;
}

/**
 * `main ↑233 ↓1 +27737 −118`, under the composer.
 *
 * Hermes Desktop shows this and the web Dashboard did not, which matters
 * because you are telling an agent to edit files: how far the repo has drifted
 * belongs in view, not behind a terminal window.
 *
 * The data is `GET /api/git/status`, the **same endpoint Desktop calls**. Two
 * of its behaviours are handled here rather than papered over: it answers a
 * null body (not a 404) for a directory that is not a repository, and it is
 * poll-only — no push event for working-tree changes exists anywhere in
 * Hermes, so this refreshes on the caller's turn/tool edges and on window
 * focus, exactly as Desktop does, instead of running a timer forever.
 */
export function GitStatusBar({ cwd, refreshKey = 0 }: GitStatusBarProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!cwd.trim()) {
      setStatus(null);
      setChecked(true);
      return;
    }
    setBusy(true);
    try {
      setStatus(parseGitStatus(await api.getGitStatus(cwd)));
    } catch {
      // A directory outside any repo, or git unavailable. Not worth an error
      // banner over a composer.
      setStatus(null);
    } finally {
      setBusy(false);
      setChecked(true);
    }
  }, [cwd]);

  useEffect(() => {
    // Deferred a microtask so the effect body itself does no setState.
    void Promise.resolve().then(load);
  }, [load, refreshKey]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Nothing to say until the first answer, and nothing at all when the
  // working directory is not a git repository.
  if (!checked || !status) return null;

  const sync = syncLabel(status);
  const diff = diffLabel(status);

  return (
    <div className="hermes-git-bar" title={summaryVi(status)}>
      <GitBranch className="h-3 w-3" />
      <code className={cn(status.detached && "is-detached")}>
        {branchLabelVi(status)}
      </code>
      {sync ? <span className="hermes-git-sync">{sync}</span> : null}
      {diff ? <span className="hermes-git-diff">{diff}</span> : null}
      {status.conflicted > 0 ? (
        <span className="hermes-git-conflict">{status.conflicted} xung đột</span>
      ) : null}
      {!hasChanges(status) ? <span className="hermes-git-clean">sạch</span> : null}
      <button
        type="button"
        className="hermes-git-refresh"
        title="Đọc lại trạng thái git"
        aria-label="Đọc lại trạng thái git"
        disabled={busy}
        onClick={() => void load()}
      >
        <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
      </button>
    </div>
  );
}
