/**
 * Live turn state for the dashboard chat, driven by the gateway event feed.
 *
 * The session store only gains the assistant message once the turn is over, so
 * polling it can never show text as it is written — the chat sat on "Hermes
 * đang xử lý nhiệm vụ…" while the terminal streamed the answer in real time.
 *
 * The PTY-side `tui_gateway.entry` already publishes every dispatcher emit to
 * the dashboard (`/api/pub` → `/api/events?channel=…`, the same feed the model
 * sidebar listens on). `message.delta` carries the assistant text token by
 * token, so subscribing to that channel gives the chat the same stream the
 * terminal renders.
 *
 * This module is the pure reducer over those events; the socket lives in
 * CommandChat.
 */

export interface LiveTurn {
  /** Assistant text streamed so far. */
  text: string;
  /** Tool currently running, if any. */
  tool: string | null;
  /** The model is reasoning (thinking/reasoning deltas are arriving). */
  thinking: boolean;
  /** The turn finished; the session store is about to catch up. */
  done: boolean;
  /** A turn is in flight (or just finished and not yet cleared). */
  active: boolean;
  /** Set when the turn ended in an error the feed reported. */
  error: string | null;
  /**
   * Hermes's own liveness watchdog says this turn stopped moving (v0.21.0's
   * `agent.turn_liveness`). Without this the "Đồng bộ Terminal: tắt" bubble
   * cheerfully rotates cute lines forever while nothing is actually happening.
   */
  stalled: string | null;
}

export const EMPTY_LIVE_TURN: LiveTurn = {
  active: false,
  done: false,
  error: null,
  stalled: null,
  text: "",
  thinking: false,
  tool: null,
};

/**
 * Recognise the warnings Hermes v0.21.0 raises when a turn stops progressing,
 * and say them in Vietnamese.
 *
 * Deliberately narrow: `status.update` carries every kind of `warn`, most of
 * them about degraded side paths the user can ignore. Only the ones that mean
 * "this turn is not moving" get to interrupt the waiting bubble — anything
 * else would train the user to ignore the notice that matters.
 */
export function stallWarningVi(text: string): string | null {
  const line = text.trim();
  if (!line) return null;

  const seconds = line.match(/\((\d+)s without activity\)/)?.[1];
  const forHowLong = seconds ? ` (đã ${seconds} giây)` : "";

  if (/turn aborted by the liveness watchdog/i.test(line)) {
    return `Hermes đã tự huỷ lượt này vì không nhúc nhích${forHowLong}. Anh gửi lại tin nhắn là được.`;
  }
  if (/stopped making progress/i.test(line)) {
    return `Lượt này có vẻ đang kẹt${forHowLong} — Hermes đang thử gỡ. Anh chờ thêm chút, hoặc bấm Dừng rồi gửi lại.`;
  }
  if (/transcript|sanitiz|sanitis/i.test(line)) {
    return "Bản ghi hội thoại phải sửa lỗi nhiều lần — nếu câu trả lời bắt đầu lạ, thử /new cho một phiên sạch.";
  }
  return null;
}

export interface LiveTurnEvent {
  type: string;
  payload?: unknown;
  /**
   * Per-session monotonic counter the gateway stamps on every event frame.
   * Both live sources carry it, so it is what lets one deduplicate the other.
   */
  seq: number | null;
  /** Session the event belongs to, when the frame names one. */
  sessionId: string | null;
}

/**
 * Read one gateway event, in either shape it arrives in.
 *
 * The `/api/events` socket sends the whole JSON-RPC frame
 * (`{method:"event", params:{…}}`), while `session.events.since` returns **bare
 * event objects** — its docstring is explicit that it hands back the frame's
 * `params` dict, "because that is exactly what the client's dispatch path
 * consumes". Requiring the envelope silently dropped every replayed delta,
 * which is why the live text never appeared.
 */
export function parseLiveTurnFrame(frame: unknown): LiveTurnEvent | null {
  if (!frame || typeof frame !== "object") return null;
  const envelope = frame as { method?: unknown; params?: unknown };
  const params = (
    envelope.method === "event" && envelope.params ? envelope.params : frame
  ) as {
    type?: unknown;
    payload?: unknown;
    seq?: unknown;
    session_id?: unknown;
  };
  if (typeof params.type !== "string") return null;
  return {
    payload: params.payload,
    seq: typeof params.seq === "number" ? params.seq : null,
    sessionId:
      typeof params.session_id === "string" ? params.session_id : null,
    type: params.type,
  };
}

/** Read one raw JSON line from the `/api/events` socket. */
export function parseLiveTurnEvent(raw: string): LiveTurnEvent | null {
  try {
    return parseLiveTurnFrame(JSON.parse(raw));
  } catch {
    return null;
  }
}

function textOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as { text?: unknown }).text;
  return typeof value === "string" ? value : "";
}

function nameOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as { name?: unknown }).name;
  return typeof value === "string" ? value : "";
}

function alreadyStreamed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (payload as { already_streamed?: unknown }).already_streamed === true;
}

/**
 * Fold one gateway event into the live turn. Unknown events pass through
 * untouched, so a Hermes update that adds event types cannot break the view.
 */
export function reduceLiveTurn(
  state: LiveTurn,
  event: LiveTurnEvent,
): LiveTurn {
  switch (event.type) {
    case "message.start":
      return { ...EMPTY_LIVE_TURN, active: true };

    case "message.delta": {
      const text = textOf(event.payload);
      if (!text) return state;
      return {
        ...state,
        active: true,
        done: false,
        // Text arriving IS progress — the stall is over.
        stalled: null,
        text: state.text + text,
        thinking: false,
      };
    }

    case "message.interim": {
      // Commentary emitted alongside a tool call. Skip the copy that already
      // arrived as deltas, or it lands in the bubble twice.
      const text = textOf(event.payload);
      if (!text || alreadyStreamed(event.payload)) return state;
      return {
        ...state,
        active: true,
        text: state.text ? `${state.text}\n\n${text}` : text,
        thinking: false,
      };
    }

    case "thinking.delta":
    case "reasoning.delta":
      return { ...state, active: true, thinking: true };

    case "tool.start":
    case "tool.generating": {
      const name = nameOf(event.payload);
      return {
        ...state,
        active: true,
        thinking: false,
        tool: name || "công cụ",
      };
    }

    case "tool.complete":
      return { ...state, tool: null };

    case "message.complete": {
      // The final text replaces the streamed buffer: the gateway sends the
      // whole message here, and a turn that never streamed (a cached or
      // tool-only reply) has nothing in `text` yet.
      const text = textOf(event.payload);
      return {
        ...state,
        active: true,
        done: true,
        text: text || state.text,
        thinking: false,
        tool: null,
      };
    }

    case "status.update": {
      // Only the stall family; everything else stays in the terminal.
      const payload = event.payload as { kind?: unknown; text?: unknown } | null;
      if (!payload || payload.kind !== "warn") return state;
      const stalled = stallWarningVi(textOf({ text: payload.text }));
      return stalled ? { ...state, active: true, stalled } : state;
    }

    case "error": {
      const text = textOf(event.payload);
      return {
        ...state,
        active: true,
        done: true,
        error: text || "Lượt trả lời gặp lỗi.",
        thinking: false,
        tool: null,
      };
    }

    default:
      return state;
  }
}

/**
 * The live bubble hands over to the polled transcript once the store has the
 * finished message — otherwise the same answer would show twice.
 */
export function shouldClearLiveTurn(
  state: LiveTurn,
  lastRole: string | undefined,
  lastHasContent: boolean,
): boolean {
  return state.done && lastRole === "assistant" && lastHasContent;
}
