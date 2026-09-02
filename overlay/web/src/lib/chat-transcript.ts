/**
 * Transcript grouping for the dashboard chat.
 *
 * The session store hands back one row per assistant turn and one per tool
 * result, so rendering it row-by-row produced a column of near-empty cards —
 * "Hermes / terminal ✓", "terminal / Kết quả công cụ", over and over. The TUI
 * collapses the same data into a single `Tool calls (6)` block with one line
 * per call, which reads in a glance.
 *
 * This module folds a message list into that shape: a run of tool activity
 * becomes one group, and everything else stays a message.
 */

import type { SessionMessage } from "@/lib/api";

export interface TranscriptToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as the model emitted them. */
  args: string;
  /** Tool output, once the matching `tool` row has arrived. */
  result?: string;
  /** False while the call is still running (no result row yet). */
  done: boolean;
}

export type TranscriptItem =
  | { kind: "message"; key: string; message: SessionMessage }
  | { kind: "tools"; key: string; calls: TranscriptToolCall[] };

function keyFor(message: SessionMessage, index: number): string {
  return `${message.timestamp ?? "m"}-${index}`;
}

/**
 * A short, single-line preview of a call's arguments — the first string value
 * in the JSON object, which is nearly always the interesting one (a command, a
 * path, a query). Falls back to the raw text.
 */
export function toolCallPreview(args: string, limit = 72): string {
  let text = "";
  try {
    const parsed = JSON.parse(args) as unknown;
    if (typeof parsed === "string") {
      text = parsed;
    } else if (parsed && typeof parsed === "object") {
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) {
          text = value;
          break;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          text = String(value);
          break;
        }
      }
    }
  } catch {
    text = args;
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** Fold a message list into renderable items, grouping runs of tool activity. */
export function groupTranscript(messages: SessionMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let open: Extract<TranscriptItem, { kind: "tools" }> | null = null;

  const closeGroup = () => {
    open = null;
  };

  messages.forEach((message, index) => {
    if (message.role === "tool") {
      const target =
        open?.calls.find((call) => call.id === message.tool_call_id) ??
        open?.calls.find((call) => !call.done);
      if (target) {
        target.result = message.content ?? "";
        target.done = true;
        return;
      }
      // A tool row with no group in front of it (history truncated mid-run):
      // start a group so the output is not dropped.
      const orphan: Extract<TranscriptItem, { kind: "tools" }> = {
        calls: [
          {
            args: "",
            done: true,
            id: message.tool_call_id ?? `orphan-${index}`,
            name: message.tool_name || "công cụ",
            result: message.content ?? "",
          },
        ],
        key: keyFor(message, index),
        kind: "tools",
      };
      items.push(orphan);
      open = orphan;
      return;
    }

    if (message.role === "system" && !message.content) return;

    const calls = message.tool_calls ?? [];
    if (message.content) {
      closeGroup();
      items.push({ key: keyFor(message, index), kind: "message", message });
    }

    if (!calls.length) {
      if (!message.content) {
        // An empty assistant row with no calls carries nothing to show.
        return;
      }
      closeGroup();
      return;
    }

    const mapped: TranscriptToolCall[] = calls.map((call) => ({
      args: call.function.arguments,
      done: false,
      id: call.id,
      name: call.function.name,
    }));

    if (open) {
      open.calls.push(...mapped);
      return;
    }

    const group: Extract<TranscriptItem, { kind: "tools" }> = {
      calls: mapped,
      key: `tools-${keyFor(message, index)}`,
      kind: "tools",
    };
    items.push(group);
    open = group;
  });

  return items;
}

/**
 * Runtime notes Hermes injects into the transcript as if the user had typed
 * them — the model-switch banner is the one people actually see. They are
 * English, verbose, and addressed to the model rather than the reader, so the
 * chat shows a short Vietnamese line instead of the raw block.
 */
const MODEL_SWITCH_PREFIX =
  "[system: the active model for this chat has changed to ";

export interface SystemNote {
  kind: "model";
  text: string;
}

export function systemNoteOf(content: string): SystemNote | null {
  const trimmed = content.trim();
  if (!trimmed.toLocaleLowerCase().startsWith(MODEL_SWITCH_PREFIX)) return null;

  // Parsed by hand rather than with one regex: model ids carry dots
  // ("glm-5.3-flash"), so a lazy pattern ending at "\." cuts them in half.
  const rest = trimmed.slice(MODEL_SWITCH_PREFIX.length);
  const sentence = rest.split(/\.\s|\.\]/)[0].trim();
  const [name, provider] = sentence.split(/\s+via provider\s+/i);
  if (!name) return null;

  return {
    kind: "model",
    text: provider
      ? `Phiên này đã chuyển sang mô hình ${name} (qua ${provider}).`
      : `Phiên này đã chuyển sang mô hình ${name}.`,
  };
}

/**
 * Hermes's own "this was not the user talking" flag.
 *
 * A background delegation batch reports back by injecting a message into the
 * originating session — `[ASYNC DELEGATION BATCH COMPLETE — deleg_…]` plus the
 * consolidated results. The agent needs that text, so it is real conversation
 * content and must never be dropped. But Hermes marks it in the store with
 * `display_kind = "internal_notification"` precisely so a UI can tell it apart
 * from something the user typed — and the Dashboard was rendering it as the
 * user's own message: a wall of English in the "Anh" bubble.
 *
 * Keyed on Hermes's flag, with a text fallback for rows written before the
 * flag existed.
 */
export function isInternalNotification(message: {
  role?: string;
  content?: string | null;
  display_kind?: string;
}): boolean {
  if (message.role !== "user") return false;
  if (message.display_kind === "internal_notification") return true;
  const text = (message.content ?? "").trimStart();
  return /^\[ASYNC DELEGATION (BATCH )?COMPLETE/i.test(text);
}

/** A one-line Vietnamese summary of a delegation-completion notification. */
export function internalNotificationSummaryVi(content: string): string {
  const text = content ?? "";
  const count = text.match(/fan-out of (\d+) subagent/i)?.[1];
  const failed = (text.match(/^✗ TASK/gm) ?? []).length;
  const duration = text.match(/Total duration:\s*([\d.]+)s/i)?.[1];

  const parts: string[] = [];
  parts.push(
    count
      ? `${count} agent phụ chạy nền đã xong`
      : "Một lượt giao việc chạy nền đã xong",
  );
  if (failed) parts.push(`${failed} tác vụ hỏng`);
  if (duration) parts.push(`${Math.round(Number(duration))} giây`);
  return parts.join(" · ");
}
