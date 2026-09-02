/**
 * Hộp xin quyền, dựng lại trong khung chat.
 *
 * When Hermes hits a dangerous command it blocks the agent thread and asks.
 * That prompt is drawn by the Ink TUI, so on the Dashboard it only appears in
 * the Terminal tab — in English, with keyboard-only controls. Someone chatting
 * in the Chat tab sees the answer simply stop coming, with no idea why.
 *
 * The gateway does emit the same request as an `approval.request` event and
 * takes the answer back over `approval.respond`, so the Dashboard can render
 * its own card: Vietnamese, clickable, right where the conversation stopped.
 * Answering here unblocks the same agent thread the terminal prompt would
 * have — one queue, two faces, exactly like the chat and the PTY.
 *
 * The wire shape (tools/approval.py + tui_gateway/methods_prompt.py):
 *
 *   request_id  string   — what `approval.respond` resolves
 *   command     string   — already redacted gateway-side
 *   description string   — English, from the pattern that matched
 *   pattern_key string   — the key `command_allowlist` would store
 *   choices     string[] — subset of once / session / always / deny
 *
 * Pure module: the component does the I/O.
 */

import { describePermission, type PermissionRisk } from "./hermes-permissions";

export type ApprovalChoice = "once" | "session" | "always" | "deny";

const CHOICES: ApprovalChoice[] = ["once", "session", "always", "deny"];

export interface ApprovalRequest {
  requestId: string;
  command: string;
  /** The gateway's own English one-liner. */
  description: string;
  patternKey: string;
  /** Vietnamese explanation of what is being asked for. */
  vi: string;
  risk: PermissionRisk;
  choices: ApprovalChoice[];
}

export interface ApprovalChoiceNote {
  choice: ApprovalChoice;
  label: string;
  vi: string;
}

/** Nhãn cho bốn lựa chọn, đúng thứ tự Hermes vẫn hiện trong Terminal. */
export const APPROVAL_CHOICE_VI: Record<ApprovalChoice, ApprovalChoiceNote> = {
  always: {
    choice: "always",
    label: "Luôn cho phép",
    vi: "Cho phép vĩnh viễn — ghi vào danh sách quyền, lần sau không hỏi nữa.",
  },
  deny: {
    choice: "deny",
    label: "Từ chối",
    vi: "Không cho chạy. Hermes sẽ tìm cách khác hoặc hỏi lại anh.",
  },
  once: {
    choice: "once",
    label: "Cho phép một lần",
    vi: "Chỉ lần này thôi. Lần sau gặp lại vẫn hỏi.",
  },
  session: {
    choice: "session",
    label: "Cho phép phiên này",
    vi: "Cho tới khi phiên kết thúc, không ghi vào cấu hình.",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Strip the "(usage: …)" tail and the trailing period so the English line
 * reads as a caption under the Vietnamese one rather than a second paragraph.
 */
function tidyDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Normalise one `approval.request` payload (or one row of
 * `approval.pending`). Returns null for anything unusable — a card with no
 * `request_id` could never be answered, so it must never be shown.
 */
export function parseApprovalRequest(payload: unknown): ApprovalRequest | null {
  const record = asRecord(payload);
  if (!record) return null;

  const requestId = text(record.request_id).trim();
  if (!requestId) return null;

  const patternKey = text(record.pattern_key).trim();
  const description = tidyDescription(text(record.description));

  // The permission dictionary is keyed by exactly this string, so the card
  // gets the same Vietnamese sentence the "Quyền & phê duyệt" panel shows.
  const known = patternKey ? describePermission(patternKey) : null;
  const explained = known && known.kind !== "unknown" ? known : null;

  const raw = Array.isArray(record.choices) ? record.choices : [];
  const choices = CHOICES.filter((choice) =>
    raw.some((item) => item === choice),
  );

  return {
    choices: choices.length ? choices : CHOICES,
    command: text(record.command),
    description,
    patternKey,
    requestId,
    risk: explained?.risk ?? "high",
    vi:
      explained?.vi ||
      description ||
      "Hermes xin phép chạy một lệnh mà nó đánh giá là nguy hiểm.",
  };
}

/** The rows of an `approval.pending` reply, oldest first, junk dropped. */
export function parsePendingApprovals(response: unknown): ApprovalRequest[] {
  const record = asRecord(response);
  const rows = Array.isArray(record?.approvals) ? record.approvals : [];
  const out: ApprovalRequest[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = parseApprovalRequest(row);
    if (!parsed || seen.has(parsed.requestId)) continue;
    seen.add(parsed.requestId);
    out.push(parsed);
  }
  return out;
}

/** Params for `approval.respond`. */
export function buildApprovalResponse(
  sessionId: string,
  request: ApprovalRequest,
  choice: ApprovalChoice,
): Record<string, unknown> {
  return {
    choice,
    request_id: request.requestId,
    session_id: sessionId,
  };
}

/** Câu báo sau khi đã trả lời. */
export function approvalOutcomeVi(choice: ApprovalChoice): string {
  switch (choice) {
    case "always":
      return "Đã cho phép vĩnh viễn — có thể thu hồi ở bảng Quyền & phê duyệt.";
    case "session":
      return "Đã cho phép trong phiên này.";
    case "once":
      return "Đã cho phép một lần.";
    default:
      return "Đã từ chối.";
  }
}

/** How many lines of the command to show before folding the rest away. */
export const COMMAND_PREVIEW_LINES = 12;

export function splitCommandPreview(command: string): {
  shown: string;
  hidden: number;
} {
  const lines = command.replace(/\s+$/, "").split("\n");
  if (lines.length <= COMMAND_PREVIEW_LINES) {
    return { hidden: 0, shown: lines.join("\n") };
  }
  return {
    hidden: lines.length - COMMAND_PREVIEW_LINES,
    shown: lines.slice(0, COMMAND_PREVIEW_LINES).join("\n"),
  };
}
