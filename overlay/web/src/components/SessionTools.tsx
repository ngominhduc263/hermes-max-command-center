import { useCallback, useState } from "react";
import {
  AlertCircle,
  GitBranch,
  HelpCircle,
  LoaderCircle,
  Navigation,
  Send,
  Shrink,
  Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  backgroundNoteVi,
  branchProblemVi,
  branchResultVi,
  btwNoteVi,
  compressConfirmVi,
  compressProblemVi,
  parseBranchResult,
  parseCompressOutcome,
  parseUndoRemoved,
  steerModeNoteVi,
  steerProblemVi,
  steerStatusVi,
  undoProblemVi,
  undoResultVi,
  type SteerMode,
} from "@/lib/session-tools";

interface SessionToolsProps {
  call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  sessionId: string;
  /** A turn is in flight. Decides which controls are legal right now. */
  running: boolean;
  hasHistory: boolean;
  /** Called after a branch, so the caller can navigate to the new session. */
  onBranched?: (storedSessionId: string) => void;
  /** Called after history changed under us (undo, compress). */
  onHistoryChanged?: () => void;
}

type Tool = "" | "ask" | "steer" | "compress" | "undo" | "branch";

/**
 * The turn-level controls: hỏi thêm, lái, nén, lùi, tách nhánh.
 *
 * Each button is gated on what the runtime will actually accept, and each
 * says the thing about itself that its name does not imply — a background
 * question cannot see the conversation, compress cannot be undone, undo does
 * not touch files, a steer on an idle session vanishes into the next turn.
 * Those sentences come from lib/session-tools.ts, where the reasoning lives.
 */
export function SessionTools({
  call,
  sessionId,
  running,
  hasHistory,
  onBranched,
  onHistoryChanged,
}: SessionToolsProps) {
  const [tool, setTool] = useState<Tool>("");
  const [text, setText] = useState("");
  const [steerMode, setSteerMode] = useState<SteerMode>("steer");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [failure, setFailure] = useState("");

  const toggle = (next: Tool) => {
    setTool((current) => (current === next ? "" : next));
    setResult("");
    setFailure("");
  };

  const run = useCallback(
    async (body: () => Promise<string>) => {
      setBusy(true);
      setFailure("");
      try {
        setResult(await body());
      } catch (reason: unknown) {
        setFailure(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const askSide = (kind: "btw" | "background") =>
    void run(async () => {
      const method = kind === "btw" ? "prompt.btw" : "prompt.background";
      await call(method, { session_id: sessionId, text: text.trim() });
      setText("");
      // The answer does not come back here — it arrives on the session's
      // event stream as btw.complete / background.complete and is rendered
      // in the transcript by CommandChat.
      return kind === "btw"
        ? "Đã hỏi thêm — câu trả lời sẽ hiện trong khung chat."
        : "Đã gửi câu hỏi nền — trả lời sẽ hiện trong khung chat.";
    });

  const sendSteer = () =>
    void run(async () => {
      const method = steerMode === "steer" ? "session.steer" : "session.redirect";
      const reply = await call<unknown>(method, {
        session_id: sessionId,
        text: text.trim(),
      });
      setText("");
      return steerStatusVi(steerMode, reply);
    });

  const compress = () =>
    void run(async () => {
      const reply = await call<unknown>("session.compress", {
        session_id: sessionId,
      });
      const outcome = parseCompressOutcome(reply);
      if (outcome.changed) onHistoryChanged?.();
      return [outcome.headline, outcome.tokenLine, outcome.note]
        .filter(Boolean)
        .join(" · ");
    });

  const undo = () =>
    void run(async () => {
      const reply = await call<unknown>("session.undo", { session_id: sessionId });
      const removed = parseUndoRemoved(reply);
      if (removed > 0) onHistoryChanged?.();
      return undoResultVi(removed);
    });

  const branch = () =>
    void run(async () => {
      const reply = await call<unknown>("session.branch", {
        session_id: sessionId,
      });
      const parsed = parseBranchResult(reply);
      if (!parsed) return "Không đọc được kết quả tách nhánh.";
      onBranched?.(parsed.storedSessionId);
      return branchResultVi(parsed);
    });

  const askProblem = text.trim() ? "" : "Chưa nhập câu hỏi.";
  const steerIssue = steerProblemVi(steerMode, text, running);
  const compressIssue = compressProblemVi(running);
  const undoIssue = undoProblemVi(running);
  const branchIssue = branchProblemVi(running, hasHistory);

  return (
    <section className="hermes-tools" aria-label="Công cụ phiên">
      <div className="hermes-tools-row">
        <ToolButton
          active={tool === "ask"}
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          label="Hỏi thêm"
          onClick={() => toggle("ask")}
        />
        <ToolButton
          active={tool === "steer"}
          icon={<Navigation className="h-3.5 w-3.5" />}
          label="Lái lượt"
          hint={running ? "" : "chỉ dùng được khi đang chạy"}
          onClick={() => toggle("steer")}
        />
        <ToolButton
          active={tool === "compress"}
          icon={<Shrink className="h-3.5 w-3.5" />}
          label="Nén"
          onClick={() => toggle("compress")}
        />
        <ToolButton
          active={tool === "undo"}
          icon={<Undo2 className="h-3.5 w-3.5" />}
          label="Lùi 1 lượt"
          onClick={() => toggle("undo")}
        />
        <ToolButton
          active={tool === "branch"}
          icon={<GitBranch className="h-3.5 w-3.5" />}
          label="Tách nhánh"
          onClick={() => toggle("branch")}
        />
      </div>

      {tool === "ask" ? (
        <div className="hermes-tools-panel">
          <textarea
            value={text}
            rows={2}
            placeholder="Câu hỏi phụ, không làm gián đoạn lượt đang chạy…"
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <p className="hermes-tools-note">{btwNoteVi()}</p>
          <div className="hermes-tools-actions">
            <button
              type="button"
              disabled={busy || !!askProblem}
              onClick={() => askSide("btw")}
            >
              <Send className="h-3.5 w-3.5" />
              Hỏi thêm (có ngữ cảnh)
            </button>
            <button
              type="button"
              className="is-secondary"
              disabled={busy || !!askProblem}
              onClick={() => askSide("background")}
            >
              Hỏi nền (phiên riêng)
            </button>
          </div>
          <p className="hermes-tools-warn">
            <AlertCircle className="h-3 w-3" />
            {backgroundNoteVi()}
          </p>
        </div>
      ) : null}

      {tool === "steer" ? (
        <div className="hermes-tools-panel">
          <div className="hermes-tools-modes">
            {(["steer", "redirect"] as SteerMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(steerMode === mode && "is-picked")}
                onClick={() => setSteerMode(mode)}
              >
                {mode === "steer" ? "Nhắc thêm" : "Đổi hướng"}
              </button>
            ))}
          </div>
          <p className="hermes-tools-note">{steerModeNoteVi(steerMode)}</p>
          <textarea
            value={text}
            rows={2}
            placeholder="Nói cho Hermes biết cần đổi gì…"
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <div className="hermes-tools-actions">
            <button type="button" disabled={busy || !!steerIssue} onClick={sendSteer}>
              <Send className="h-3.5 w-3.5" />
              Gửi
            </button>
          </div>
          {steerIssue ? <p className="hermes-tools-block">{steerIssue}</p> : null}
        </div>
      ) : null}

      {tool === "compress" ? (
        <div className="hermes-tools-panel">
          <p className="hermes-tools-warn">
            <AlertCircle className="h-3 w-3" />
            {compressConfirmVi()}
          </p>
          <div className="hermes-tools-actions">
            <button
              type="button"
              disabled={busy || !!compressIssue}
              onClick={compress}
            >
              {busy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Shrink className="h-3.5 w-3.5" />
              )}
              Nén hội thoại
            </button>
          </div>
          {compressIssue ? (
            <p className="hermes-tools-block">{compressIssue}</p>
          ) : null}
        </div>
      ) : null}

      {tool === "undo" ? (
        <div className="hermes-tools-panel">
          <p className="hermes-tools-note">
            Lùi đúng <strong>một</strong> lượt hội thoại. Gateway không nhận số
            lượt, và <strong>file Hermes đã ghi thì vẫn nguyên</strong> — muốn
            lấy file cũ lại thì dùng checkpoint.
          </p>
          <div className="hermes-tools-actions">
            <button type="button" disabled={busy || !!undoIssue} onClick={undo}>
              <Undo2 className="h-3.5 w-3.5" />
              Lùi 1 lượt
            </button>
          </div>
          {undoIssue ? <p className="hermes-tools-block">{undoIssue}</p> : null}
        </div>
      ) : null}

      {tool === "branch" ? (
        <div className="hermes-tools-panel">
          <p className="hermes-tools-note">
            Tạo một phiên mới chép lại toàn bộ hội thoại này. Bản gốc vẫn còn
            nguyên và vẫn nằm trong danh sách phiên.
          </p>
          <div className="hermes-tools-actions">
            <button type="button" disabled={busy || !!branchIssue} onClick={branch}>
              <GitBranch className="h-3.5 w-3.5" />
              Tách nhánh
            </button>
          </div>
          {branchIssue ? <p className="hermes-tools-block">{branchIssue}</p> : null}
        </div>
      ) : null}

      {result ? <p className="hermes-tools-result">{result}</p> : null}
      {failure ? <p className="hermes-tools-bad">{failure}</p> : null}
    </section>
  );
}

function ToolButton({
  active,
  icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("hermes-tools-tab", active && "is-active")}
      title={hint || label}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
