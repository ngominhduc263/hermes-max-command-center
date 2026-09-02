import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileDiff, History, LoaderCircle, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  disabledNoteVi,
  emptyDiffNoteVi,
  filesInDiff,
  parseCheckpoints,
  parseRestoreResult,
  parseRollbackDiff,
  restoreConfirmVi,
  restoreResultVi,
  scopeNoteVi,
  truncatedNoteVi,
  type Checkpoint,
  type RollbackDiff,
} from "@/lib/hermes-rollback";

interface CheckpointsPanelProps {
  call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  sessionId: string;
  onHistoryChanged?: () => void;
}

/**
 * Checkpoints — the file snapshots Hermes takes before it writes.
 *
 * This panel is deliberately cautious. `rollback.restore` on this gateway runs
 * without safe mode, so a whole-tree restore overwrites files the user edited
 * by hand; and it always drops exactly one conversation exchange no matter
 * which checkpoint was chosen. Both facts are in the confirm text, and the
 * per-file restore — which touches no history at all — is offered first.
 *
 * The feature is also off unless `HERMES_TUI_CHECKPOINTS=1` is in the web
 * server's environment; `config.yaml` has no effect here. Rather than showing
 * an empty list that looks broken, the disabled state says exactly that.
 */
export function CheckpointsPanel({
  call,
  sessionId,
  onHistoryChanged,
}: CheckpointsPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [picked, setPicked] = useState("");
  const [diff, setDiff] = useState<RollbackDiff | null>(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState("");
  const [failure, setFailure] = useState("");

  const load = useCallback(async () => {
    try {
      const parsed = parseCheckpoints(
        await call<unknown>("rollback.list", { session_id: sessionId }),
      );
      setEnabled(parsed.enabled);
      setCheckpoints(parsed.checkpoints);
    } catch (reason: unknown) {
      setEnabled(false);
      setFailure(reason instanceof Error ? reason.message : String(reason));
    }
  }, [call, sessionId]);

  useEffect(() => {
    // Deferred: `load` starts with a setState and would cascade a render if
    // it ran synchronously in the effect body.
    void Promise.resolve().then(load);
  }, [load]);

  const showDiff = useCallback(
    async (checkpoint: Checkpoint) => {
      setPicked(checkpoint.hash);
      setDiff(null);
      setBusy(checkpoint.hash);
      setResult("");
      setFailure("");
      try {
        setDiff(
          parseRollbackDiff(
            await call<unknown>("rollback.diff", {
              // Always the full hash: the RPC also accepts a 1-based index,
              // but a concurrent tool call inserts a checkpoint at position 1
              // and shifts every index under us.
              hash: checkpoint.hash,
              session_id: sessionId,
            }),
          ),
        );
      } catch (reason: unknown) {
        setFailure(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy("");
      }
    },
    [call, sessionId],
  );

  const restore = useCallback(
    async (checkpoint: Checkpoint, filePath?: string) => {
      if (!window.confirm(restoreConfirmVi(checkpoint.shortHash, filePath))) return;
      setBusy(checkpoint.hash);
      setResult("");
      setFailure("");
      try {
        const parsed = parseRestoreResult(
          await call<unknown>("rollback.restore", {
            hash: checkpoint.hash,
            session_id: sessionId,
            ...(filePath ? { file_path: filePath } : {}),
          }),
        );
        setResult(restoreResultVi(parsed));
        if (parsed.success && parsed.historyRemoved > 0) onHistoryChanged?.();
        void load();
      } catch (reason: unknown) {
        // A 5021 means the files were already restored and only the history
        // rewind failed — so this is never "nothing happened".
        setFailure(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy("");
      }
    },
    [call, load, onHistoryChanged, sessionId],
  );

  if (enabled === null) {
    return (
      <p className="hermes-cp-muted">
        <LoaderCircle className="h-3 w-3 animate-spin" /> Đang đọc checkpoint…
      </p>
    );
  }

  if (!enabled) {
    return (
      <div className="hermes-cp">
        <p className="hermes-cp-off">
          <AlertCircle className="h-3.5 w-3.5" />
          {disabledNoteVi()}
        </p>
      </div>
    );
  }

  const files = diff ? filesInDiff(diff.diff) : [];
  const current = checkpoints.find((entry) => entry.hash === picked) ?? null;

  return (
    <div className="hermes-cp">
      <p className="hermes-cp-scope">{scopeNoteVi()}</p>

      {!checkpoints.length ? (
        <p className="hermes-cp-muted">
          Chưa có checkpoint nào. Hermes chỉ chụp trước khi ghi file — lượt chỉ
          đọc hoặc chỉ trò chuyện thì không tạo checkpoint.
        </p>
      ) : (
        <ul className="hermes-cp-list">
          {checkpoints.map((entry) => (
            <li key={entry.hash} className={cn(entry.hash === picked && "is-picked")}>
              <button type="button" onClick={() => void showDiff(entry)}>
                <History className="h-3 w-3" />
                <time>{entry.timestamp || "không rõ giờ"}</time>
                <code>{entry.shortHash}</code>
                {busy === entry.hash ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <FileDiff className="h-3 w-3" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {diff && current ? (
        <div className="hermes-cp-diff">
          {diff.ambiguousEmpty ? (
            <p className="hermes-cp-warn">
              <AlertCircle className="h-3 w-3" />
              {emptyDiffNoteVi()}
            </p>
          ) : (
            <>
              {diff.stat ? <pre className="hermes-cp-stat">{diff.stat}</pre> : null}
              <pre className="hermes-cp-body">{diff.diff}</pre>
              {diff.truncated ? (
                <p className="hermes-cp-warn">
                  <AlertCircle className="h-3 w-3" />
                  {truncatedNoteVi()}
                </p>
              ) : null}
            </>
          )}

          {files.length ? (
            <div className="hermes-cp-files">
              <span>Khôi phục riêng một file (không đụng hội thoại):</span>
              {files.map((file) => (
                <button
                  key={file}
                  type="button"
                  disabled={busy === current.hash}
                  onClick={() => void restore(current, file)}
                >
                  <RotateCcw className="h-3 w-3" />
                  {file}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="hermes-cp-restore-all"
            disabled={busy === current.hash}
            onClick={() => void restore(current)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Khôi phục toàn bộ thư mục về {current.shortHash}
          </button>
        </div>
      ) : null}

      {result ? <p className="hermes-cp-result">{result}</p> : null}
      {failure ? <p className="hermes-cp-bad">{failure}</p> : null}
    </div>
  );
}
