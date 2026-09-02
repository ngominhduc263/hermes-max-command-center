import { Button } from "@nous-research/ui/ui/components/button";
import {
  Bot,
  Check,
  BookOpen,
  ChevronsUpDown,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  CircleStop,
  Copy,
  FileText,
  HelpCircle,
  History,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Paperclip,
  Search,
  Send,
  SquareArrowDown,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AgentRoom } from "@/components/AgentRoom";
import { ClarifyCard } from "@/components/ClarifyCard";
import { PetCorner } from "@/components/PetCorner";
import { SessionTools } from "@/components/SessionTools";
import { CheckpointsPanel } from "@/components/CheckpointsPanel";
import { parseSideAnswer, type SideAnswer } from "@/lib/session-tools";
import { ContextGauge } from "@/components/ContextGauge";
import { FavoriteModelSwitch } from "@/components/FavoriteModelSwitch";
import { Markdown } from "@/components/Markdown";
import {
  api,
  authedFetch,
  buildWsUrl,
  type SessionInfo,
  type SessionMessage,
} from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import {
  EMPTY_LIVE_TURN,
  parseLiveTurnFrame,
  reduceLiveTurn,
  shouldClearLiveTurn,
  type LiveTurn,
} from "@/lib/chat-live-turn";
import {
  EVENTS_MAX_RECONNECT_ATTEMPTS,
  eventsReconnectDelayMs,
  shouldRetryEventsClose,
} from "@/lib/events-reconnect";
import {
  basename,
  formatBytes,
  imagePathsInMessage,
  parseMessageAttachments,
  type ParsedMessage,
} from "@/lib/chat-composer";
import {
  commandForLine,
  HERMES_COMMANDS,
  isCommandQuery,
  matchCommands,
  type HermesCommand,
} from "@/lib/hermes-commands";
import { mergeCommandCatalog } from "@/lib/chat-command-catalog";
import {
  buildClarifyResponse,
  parseClarifyExpire,
  parseClarifyRequest,
  type ClarifyDraft,
  type ClarifyQuestion,
  type ClarifyRequest,
} from "@/lib/chat-clarify";
import {
  applyDelegationStatus,
  EMPTY_AGENT_ROOM,
  hasAgents,
  isAgentEvent,
  liveAgents,
  reduceAgentRoom,
  type AgentRoom as AgentRoomState,
  type RoomAgent,
} from "@/lib/agent-room";
import {
  EMPTY_CONTEXT_USAGE,
  mergeContextUsage,
  parseContextUsage,
  type ContextUsage,
} from "@/lib/chat-context-usage";
import {
  approvalOutcomeVi,
  APPROVAL_CHOICE_VI,
  buildApprovalResponse,
  parseApprovalRequest,
  parsePendingApprovals,
  splitCommandPreview,
  type ApprovalChoice,
  type ApprovalRequest,
} from "@/lib/chat-approval";
import {
  internalNotificationSummaryVi,
  isInternalNotification,
  groupTranscript,
  systemNoteOf,
  toolCallPreview,
  type TranscriptToolCall,
} from "@/lib/chat-transcript";
import {
  waitingLineAt,
  WAITING_LINE_MS,
} from "@/lib/chat-waiting-lines";
import type { PtyConnectionState } from "@/lib/pty-reconnect";
import { cn, timeAgo } from "@/lib/utils";

const POLL_INTERVAL_MS = 1100;
/** Composer grows with its content up to this height, then scrolls. */
const COMPOSER_MAX_HEIGHT_PX = 260;
/** Distance from the bottom that still counts as "pinned". */
const STICK_TO_BOTTOM_PX = 96;
/** How long a finished live turn lingers before the transcript takes over. */
const LIVE_TURN_RETIRE_MS = 6000;
/** How often the gateway's per-session event ring is drained. */
const LIVE_POLL_INTERVAL_MS = 320;
/** Rows the `/` palette shows before it scrolls. */
const PALETTE_LIMIT = 40;

export interface CommandChatAttachment {
  /** Stable key for React lists and removal — upload paths can repeat. */
  id: string;
  name: string;
  /** Absolute path on the Hermes host; this is what the agent receives. */
  path: string;
  kind: "image" | "file";
  size: number;
  /** Object URL for the local file, images only. Revoked on removal. */
  previewUrl?: string;
}

interface CommandChatProps {
  initialSessionId: string | null;
  profile?: string;
  /**
   * Mirrors the sub-agent room to the page, so the right-hand control
   * panel can show the same tree without opening a second gateway
   * connection or polling `delegation.status` on its own.
   */
  onAgentRoomChange?: (room: AgentRoomState) => void;
  enabled: boolean;
  connectionState: PtyConnectionState;
  /** Chat-tab channel id — ties the live event feed to this tab's PTY. */
  channel?: string;
  /**
   * Resolves once the PTY has accepted the whole turn — with a warning string
   * when the turn went out but something needs saying. Rejects on failure, in
   * which case the composer keeps its text so the turn can be retried.
   */
  onSubmit: (
    text: string,
    attachments: CommandChatAttachment[],
  ) => Promise<string | null>;
  onStop: () => void;
  onAttachFiles: (files: File[]) => Promise<CommandChatAttachment[]>;
  onSessionResolved?: (sessionId: string) => void;
  /** Called after sending a command whose UI only exists in the TUI. */
  onNeedsTerminal?: () => void;
  /** Live-feed state, surfaced in the toolbar so it cannot be missed. */
  onLiveStatus?: (status: string) => void;
  /**
   * Stream the answer as the terminal writes it. Off, the bubble waits
   * quietly behind a rotating line — kinder on slow thinking models, whose
   * word-a-second dribble is more distracting than a pause.
   */
  syncTerminal?: boolean;
  /**
   * Switch the running session's model — the same `/model <id>` the control
   * panel drives. Given, the composer grows a quick switcher for the models
   * the user marked as favourites.
   */
  onSwitchModel?: (model: string) => Promise<boolean>;
  /** Fired when the quick switcher changed the configured model. */
  onModelChanged?: () => void;
}

const SUGGESTIONS = [
  "Tóm tắt các việc anh cần làm hôm nay",
  "Đọc tệp anh vừa đính kèm và rút ra ý chính",
  "Kiểm tra trạng thái hệ thống rồi báo cáo ngắn gọn",
];

function transferHasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  if (transfer.types?.length) {
    return Array.from(transfer.types).includes("Files");
  }
  return (transfer.files?.length ?? 0) > 0;
}

function filesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const out: File[] = [];
  if (transfer.items?.length) {
    for (let i = 0; i < transfer.items.length; i++) {
      const item = transfer.items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  if (!out.length && transfer.files?.length) {
    for (let i = 0; i < transfer.files.length; i++) out.push(transfer.files[i]);
  }
  return out;
}

function pickLiveSession(sessions: SessionInfo[]): SessionInfo | null {
  const usable = sessions.filter(
    (session) => session.source !== "tool" && session.message_count > 0,
  );
  return usable.find((session) => session.is_active) ?? null;
}

function messageIdentity(messages: SessionMessage[]): string {
  const last = messages.at(-1);
  return `${messages.length}:${last?.role ?? ""}:${last?.timestamp ?? ""}:${last?.content?.length ?? 0}`;
}

function displayToolArguments(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    const pretty = JSON.stringify(value, null, 2);
    return pretty.length > 900 ? `${pretty.slice(0, 900)}\n…` : pretty;
  } catch {
    return raw.length > 900 ? `${raw.slice(0, 900)}…` : raw;
  }
}

/**
 * One run of tool activity, drawn the way the TUI draws it: a single header
 * with the count, then one line per call. Everything stays collapsed until
 * asked for — the detail is the exception, not the default.
 */
function ToolCallGroup({ calls }: { calls: TranscriptToolCall[] }) {
  const running = calls.filter((call) => !call.done).length;
  return (
    <div className="hermes-command-tools">
      <div className="hermes-command-tools-head">
        <Wrench className="h-3.5 w-3.5" />
        <strong>Công cụ ({calls.length})</strong>
        {running ? (
          <span className="hermes-command-tools-running">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            đang chạy {running}
          </span>
        ) : (
          <span className="hermes-command-tools-done">
            <CheckCircle2 className="h-3 w-3" /> hoàn tất
          </span>
        )}
      </div>
      {calls.map((call) => {
        const preview = toolCallPreview(call.args);
        return (
          <details key={call.id} className="hermes-command-tool-row group">
            <summary>
              <span className="hermes-command-tool-dot" aria-hidden />
              <span className="hermes-command-tool-name">{call.name}</span>
              {preview ? (
                <span className="hermes-command-tool-preview">{preview}</span>
              ) : null}
              {call.done ? null : (
                <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
              )}
              <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
            </summary>
            {call.args && call.args !== "{}" ? (
              <pre>{displayToolArguments(call.args)}</pre>
            ) : null}
            {call.result ? (
              <pre className="hermes-command-tool-result">{call.result}</pre>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

function CopyMessageButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      className="hermes-command-message-copy"
      title="Sao chép tin nhắn"
      aria-label="Sao chép tin nhắn"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            if (timerRef.current) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => {
            /* clipboard blocked — nothing useful to surface here */
          });
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/**
 * `GET /api/media` hands back a data URL for images the agent wrote on the
 * Hermes host — the browser cannot read that disk itself. The transcript
 * re-polls about once a second, so results are memoised per path; a failed
 * lookup is evicted so it can be retried on the next mount.
 */
const mediaCache = new Map<string, Promise<string>>();
/** Each entry holds a whole image as base64 — keep the tail, drop the rest. */
const MEDIA_CACHE_LIMIT = 24;

function loadHostImage(path: string): Promise<string> {
  const cached = mediaCache.get(path);
  if (cached) return cached;

  while (mediaCache.size >= MEDIA_CACHE_LIMIT) {
    const oldest = mediaCache.keys().next().value;
    if (oldest === undefined) break;
    mediaCache.delete(oldest);
  }

  const request = authedFetch(`/api/media?path=${encodeURIComponent(path)}`)
    .then(async (response) => {
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(detail || `HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { data_url?: string };
      if (!payload?.data_url) throw new Error("Ảnh không đọc được");
      return payload.data_url;
    })
    .catch((error: unknown) => {
      mediaCache.delete(path);
      throw error;
    });

  mediaCache.set(path, request);
  return request;
}

function MessageImage({ path }: { path: string }) {
  // Both results carry the path they belong to, so a changed `path` reads as
  // "loading" without a state reset inside the effect.
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadHostImage(path)
      .then((url) => {
        if (alive) setLoaded({ path, url });
      })
      .catch(() => {
        if (alive) setFailedPath(path);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  const dataUrl = loaded?.path === path ? loaded.url : null;
  const failed = failedPath === path;

  if (failed) {
    return (
      <span className="hermes-command-image-missing" title={path}>
        <ImageIcon className="h-3 w-3" />
        <span>{basename(path)} — không mở được từ Dashboard</span>
      </span>
    );
  }

  return (
    <figure
      className={cn("hermes-command-image", expanded && "is-expanded")}
      title={path}
    >
      {dataUrl ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Thu nhỏ ảnh" : "Phóng to ảnh"}
        >
          <img src={dataUrl} alt={basename(path)} />
        </button>
      ) : (
        <span className="hermes-command-image-loading">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Đang tải ảnh…
        </span>
      )}
      <figcaption>{basename(path)}</figcaption>
    </figure>
  );
}

function MessageCard({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const systemNote = useMemo(
    () => (message.content ? systemNoteOf(message.content) : null),
    [message.content],
  );

  const parsed = useMemo(
    () =>
      isUser && message.content
        ? parseMessageAttachments(message.content)
        : {
            attachments: [] as ParsedMessage["attachments"],
            text: message.content ?? "",
          },
    [isUser, message.content],
  );

  const imagePaths = useMemo(
    () => (message.content ? imagePathsInMessage(message.content) : []),
    [message.content],
  );

  if (message.role === "system" && !message.content) return null;

  // A background delegation batch reports back by injecting its consolidated
  // result into the session. Hermes flags it `internal_notification` because
  // the user did not type it — but the Dashboard was drawing it in the "Anh"
  // bubble, so a routine fan-out looked like the user had pasted a wall of
  // English. Collapse it, and keep the full text one click away: the agent
  // acted on it, so it must stay readable.
  if (isInternalNotification(message)) {
    return (
      <details className="hermes-command-internal-note">
        <summary>
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>{internalNotificationSummaryVi(message.content ?? "")}</span>
          <em>Hermes tự báo về — xem chi tiết</em>
        </summary>
        <pre>{message.content}</pre>
      </details>
    );
  }

  if (systemNote) {
    return (
      <div className="hermes-command-runtime-note">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>{systemNote.text}</span>
      </div>
    );
  }
  if (isUser && !parsed.text && parsed.attachments.length === 0) return null;

  return (
    <article
      className={cn(
        "hermes-command-message",
        isUser && "is-user",
        isAssistant && "is-assistant",
      )}
    >
      <header>
        <span className="hermes-command-message-avatar">
          {isUser ? (
            <CircleUserRound className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </span>
        <strong>{isUser ? "Anh" : "Hermes"}</strong>
        {message.timestamp ? <time>{timeAgo(message.timestamp)}</time> : null}
        {message.content ? <CopyMessageButton value={message.content} /> : null}
      </header>

      {parsed.attachments.length ? (
        <div className="hermes-command-message-files">
          {parsed.attachments.map((attachment, index) => (
            <span key={`${attachment.label}-${index}`}>
              {attachment.kind === "image" ? (
                <ImageIcon className="h-3 w-3" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              <span>{attachment.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      {message.content ? (
        isUser ? (
          parsed.text ? (
            <div className="hermes-command-message-plain">{parsed.text}</div>
          ) : null
        ) : (
          <Markdown content={message.content} />
        )
      ) : null}

      {imagePaths.length ? (
        <div className="hermes-command-image-grid">
          {imagePaths.map((path) => (
            <MessageImage key={path} path={path} />
          ))}
        </div>
      ) : null}

    </article>
  );
}

function ReferenceRow({
  command,
  onSelect,
}: {
  command: HermesCommand;
  onSelect: (command: HermesCommand) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "hermes-command-reference-row",
        command.common && "is-common",
      )}
      onClick={() => onSelect(command)}
    >
      <span className="hermes-command-reference-name">
        /{command.name}
        {command.args ? <em>{command.args}</em> : null}
        {command.source === "gateway" ? (
          <i className="hermes-command-new">mới</i>
        ) : null}
      </span>
      <span className="hermes-command-reference-vi">{command.vi}</span>
      <span className="hermes-command-reference-meta">
        {command.aliases?.length ? (
          <code>{command.aliases.map((alias) => `/${alias}`).join(" · ")}</code>
        ) : null}
        {command.needsTerminal ? <b>mở bảng chọn ở Terminal</b> : null}
      </span>
    </button>
  );
}

function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: CommandChatAttachment;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "hermes-command-attachment",
        attachment.kind === "image" && "is-image",
      )}
      title={attachment.path}
    >
      <span className="hermes-command-attachment-thumb">
        {attachment.previewUrl ? (
          <img src={attachment.previewUrl} alt={attachment.name} />
        ) : attachment.kind === "image" ? (
          <ImageIcon className="h-4 w-4" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
      </span>
      <span className="hermes-command-attachment-meta">
        <strong>{attachment.name}</strong>
        <em>
          {attachment.kind === "image" ? "Ảnh" : "Tệp"}
          {attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}
        </em>
      </span>
      <button type="button" onClick={onRemove} aria-label={`Bỏ ${attachment.name}`}>
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function CommandChat({
  initialSessionId,
  profile,
  onAgentRoomChange,
  enabled,
  connectionState,
  channel,
  onSubmit,
  onStop,
  onAttachFiles,
  onSessionResolved,
  onNeedsTerminal,
  onLiveStatus,
  syncTerminal = true,
  onSwitchModel,
  onModelChanged,
}: CommandChatProps) {
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  const [mayDiscoverSession, setMayDiscoverSession] = useState(
    Boolean(initialSessionId),
  );
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<CommandChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [messageKey, setMessageKey] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [skillCommands, setSkillCommands] = useState<HermesCommand[]>([]);
  // Null until the gateway answers `commands.catalog`; the baked list stands in
  // meanwhile and stays if the RPC never lands.
  const [catalogCommands, setCatalogCommands] = useState<HermesCommand[] | null>(
    null,
  );
  const [catalogNote, setCatalogNote] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [liveTurn, setLiveTurn] = useState<LiveTurn>(EMPTY_LIVE_TURN);
  const [liveStatus, setLiveStatus] = useState("chưa nối");
  // Hermes chặn luồng agent lại và chờ khi gặp lệnh nguy hiểm. Hộp hỏi đó
  // vốn chỉ vẽ trong Terminal, nên ở khung chat câu trả lời "im" mà không
  // rõ vì sao. Gateway có phát `approval.request`, nên dựng lại ở đây.
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null);
  const [contextUsage, setContextUsage] =
    useState<ContextUsage>(EMPTY_CONTEXT_USAGE);
  const [chatConfig, setChatConfig] = useState<unknown>(null);
  const [agentRoom, setAgentRoom] =
    useState<AgentRoomState>(EMPTY_AGENT_ROOM);
  /**
   * Answers to side questions. They never enter the session's history — both
   * `prompt.btw` and `prompt.background` deliberately leave the transcript
   * untouched — so the Dashboard keeps them here and renders them beside the
   * conversation rather than inside it.
   */
  const [sideAnswers, setSideAnswers] = useState<SideAnswer[]>([]);
  /** Bumped on a `pet.changed` broadcast so the pet re-reads its sprite. */
  const [petTick, setPetTick] = useState(0);
  /** Which utility drawer is open: "" | "tools" | "checkpoints". */
  const [drawer, setDrawer] = useState("");
  /**
   * Render-safe mirror of `gatewaySidRef`. The ref stays the source of
   * truth for the event filter — that runs on every frame and must not
   * wait for a re-render — but reading a ref during render is exactly the
   * kind of stale read that makes a panel point at the wrong session.
   */
  const [gatewaySid, setGatewaySid] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [answering, setAnswering] = useState<ApprovalChoice | null>(null);
  // The client that the poller owns, so the buttons can answer on it.
  const gatewayRef = useRef<GatewayClient | null>(null);
  const liveCountRef = useRef(0);
  const [waitingTick, setWaitingTick] = useState(0);
  // Seeded from the turn's own event sequence rather than Math.random, so
  // rendering stays pure and two turns still open on different lines.
  const [waitingSeed, setWaitingSeed] = useState(0);
  // Highest event seq folded in, so the two live sources never double-apply.
  const liveSeqRef = useRef<number | null>(null);
  // The gateway's own id for this session — not the same string the URL and
  // the session store use. See the poller below.
  const gatewaySidRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickToBottomRef = useRef(true);
  const requestRef = useRef(0);
  const dragDepthRef = useRef(0);
  const previewUrlsRef = useRef(new Set<string>());
  const paletteActiveRef = useRef<HTMLButtonElement | null>(null);

  const waiting = !syncTerminal && liveTurn.active && !liveTurn.done;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(
      () => setWaitingTick((tick) => tick + 1),
      WAITING_LINE_MS,
    );
    return () => window.clearInterval(timer);
  }, [waiting]);

  const transcript = useMemo(() => groupTranscript(messages), [messages]);
  const connected = connectionState === "open";
  const busy = uploading || sending;

  // Object URLs are minted by the page (it owns the File objects) and released
  // here, where an attachment's lifetime actually ends.
  const forgetPreview = useCallback((attachment: CommandChatAttachment) => {
    if (!attachment.previewUrl) return;
    previewUrlsRef.current.delete(attachment.previewUrl);
    URL.revokeObjectURL(attachment.previewUrl);
  }, []);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const loadConversation = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      let sessionId = activeSessionId;
      if (!sessionId) {
        if (!mayDiscoverSession) {
          if (request === requestRef.current) setInitialLoading(false);
          return;
        }
        const recent = await api.getSessions(12, 0, profile ?? "", "recent");
        const live = pickLiveSession(recent.sessions);
        if (!live) {
          if (request === requestRef.current) setInitialLoading(false);
          return;
        }
        sessionId = live.id;
        if (request === requestRef.current) {
          setActiveSessionId(live.id);
          onSessionResolved?.(live.id);
        }
      }

      const response = await api.getSessionMessages(sessionId, profile);
      if (request !== requestRef.current) return;
      const nextKey = messageIdentity(response.messages);
      setMessages(response.messages);
      setMessageKey(nextKey);
      setLoadError(null);
      setInitialLoading(false);

      const last = response.messages.at(-1);
      if (last?.role === "assistant" && !last.tool_calls?.length) {
        setAwaitingReply(false);
      }
      setLiveTurn((state) =>
        shouldClearLiveTurn(state, last?.role, Boolean(last?.content))
          ? EMPTY_LIVE_TURN
          : state,
      );
    } catch (error) {
      if (request !== requestRef.current) return;
      setLoadError(error instanceof Error ? error.message : String(error));
      setInitialLoading(false);
    }
  }, [activeSessionId, mayDiscoverSession, onSessionResolved, profile]);

  useEffect(() => {
    if (!enabled) return;
    const initialTimer = window.setTimeout(() => {
      void loadConversation();
    }, 0);
    const timer = window.setInterval(() => {
      void loadConversation();
    }, POLL_INTERVAL_MS);
    return () => {
      requestRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [enabled, loadConversation]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || (!stickToBottomRef.current && !initialLoading)) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [initialLoading, messageKey, awaitingReply, liveTurn.text, liveTurn.tool]);

  // Auto-growing composer, capped so the transcript never disappears.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      COMPOSER_MAX_HEIGHT_PX,
    )}px`;
  }, [composer, attachments.length]);

  // The terminal's `/` menu is the gateway's completer: the baked-in registry
  // plus whatever skills this install has. Skills are per-install, so pull the
  // live list and fold it in under its own category.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const skills = await api.getSkills(profile);
        if (!alive || !Array.isArray(skills)) return;
        setSkillCommands(
          skills
            .filter((skill) => skill.enabled)
            .map((skill) => ({
              category: "Kỹ năng",
              description: skill.description || "Kỹ năng của Hermes",
              name: skill.name,
              vi: skill.description || "Kỹ năng do anh cài cho Hermes.",
            })),
        );
      } catch {
        // The palette is a convenience: a skills lookup that fails — or an
        // api surface without it — just means the built-in commands are all
        // it offers. It must never take the chat down with it.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, profile]);

  // …and the commands themselves. The baked list is a snapshot of v0.20.6, so
  // after a `hermes update`, a plugin install or a new quick command it is
  // simply wrong. The gateway knows the real set — ask it once per PTY session
  // and fold the answer over the baked Vietnamese notes.
  useEffect(() => {
    if (!enabled || connectionState !== "open") return;
    let alive = true;
    const gateway = new GatewayClient();

    void (async () => {
      try {
        if (gateway.connectionState !== "open") await gateway.connect();
        const payload = await gateway.request<unknown>("commands.catalog");
        if (!alive) return;
        const merged = mergeCommandCatalog(payload);
        if (merged.commands === HERMES_COMMANDS) return;
        setCatalogCommands(merged.commands);
        setCatalogNote(
          merged.added.length
            ? `đồng bộ từ Hermes · ${merged.added.length} lệnh mới`
            : "đồng bộ từ Hermes",
        );
      } catch {
        // Older gateway, closed socket, anything: the baked list is a complete
        // and working palette on its own. Never let this take the chat down.
      } finally {
        gateway.close();
      }
    })();

    return () => {
      alive = false;
      gateway.close();
    };
  }, [connectionState, enabled]);

  // The store normally supersedes a finished turn within a poll or two, but a
  // turn that ends without an assistant message (tool-only) never satisfies
  // that condition — so retire it on a timer as well.
  useEffect(() => {
    if (!liveTurn.done) return;
    const timer = window.setTimeout(
      () => setLiveTurn(EMPTY_LIVE_TURN),
      LIVE_TURN_RETIRE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [liveTurn.done]);

  const applyLiveFrame = useCallback(
    (frame: unknown) => {
      const parsed = parseLiveTurnFrame(frame);
      if (!parsed) return;
      // A frame that names a different session belongs to another tab's chat.
      const mine = gatewaySidRef.current ?? activeSessionId;
      if (parsed.sessionId && mine && parsed.sessionId !== mine) return;
    // Both live sources carry the gateway's per-session `seq`, so whichever
    // delivers an event first wins and the other one's copy is dropped.
      if (parsed.seq !== null) {
        if (liveSeqRef.current !== null && parsed.seq <= liveSeqRef.current) {
          return;
        }
        liveSeqRef.current = parsed.seq;
      }
      // Sub-agent lifecycle belongs to the agent room, not the turn reducer:
      // these frames describe other agents' work, not Hermes's own reply. They
      // still pass through the seq guard above, so a replayed frame and its
      // live twin cannot both land.
      if (isAgentEvent(parsed.type)) {
        setAgentRoom((room) => reduceAgentRoom(room, parsed));
        liveCountRef.current += 1;
        const heard = `đang nghe · ${liveCountRef.current} sự kiện`;
        setLiveStatus(heard);
        onLiveStatus?.(heard);
        return;
      }
      // A clarify blocks the whole turn until it is answered, exactly like an
      // approval — so it gets the same treatment: its own card, not the turn
      // reducer. Unlike approvals there is no `clarify.pending` RPC to drain
      // on attach, so the replay above is the only recovery path.
      if (parsed.type === "clarify.request") {
        const request = parseClarifyRequest(parsed.payload);
        if (request) setClarify(request);
        return;
      }
      if (parsed.type === "clarify.expire") {
        const expired = parseClarifyExpire(parsed.payload);
        setClarify((current) =>
          current && (!expired || current.requestId === expired) ? null : current,
        );
        return;
      }
      // A side question's answer arrives on the parent session's stream but
      // was never written into its history, so it must not reach the turn
      // reducer — it is not part of the reply being streamed.
      if (parsed.type === "btw.complete" || parsed.type === "background.complete") {
        const answer = parseSideAnswer(
          parsed.type === "btw.complete" ? "btw" : "background",
          parsed.payload,
        );
        if (answer) {
          setSideAnswers((current) =>
            current.some((entry) => entry.taskId === answer.taskId)
              ? current
              : [...current, answer].slice(-6),
          );
        }
        return;
      }
      // The pet's sprite, name or size changed somewhere else (the terminal,
      // `hermes pets`, another tab). This says nothing about the pose.
      if (parsed.type === "pet.changed") {
        // Re-read either way: the broadcast also fires when the pet was
        // turned off, and `parsePetMeta` returns an object in both cases.
        setPetTick((value) => value + 1);
        return;
      }
      // An approval is not part of the answer — it is the answer being held
      // hostage. Route it to its own card instead of the turn reducer.
      if (parsed.type === "approval.request") {
        const request = parseApprovalRequest(parsed.payload);
        if (request) {
          setApproval(request);
          setApprovalNote("");
        }
        return;
      }
      if (parsed.type === "approval.resolved" || parsed.type === "approval.cancelled") {
        // Answered somewhere else — the Terminal tab, a phone, /approve.
        setApproval(null);
        return;
      }
      if (parsed.type === "message.start") {
        setWaitingSeed(parsed.seq ?? 0);
        setWaitingTick(0);
      }
      // Every finished turn carries the gateway's own `_get_usage` snapshot,
      // so the context gauge stays live without a poll of its own. A turn that
      // reports no occupancy (interrupted, or an engine that cannot measure
      // one) leaves the last real reading alone rather than blanking it.
      if (parsed.type === "message.complete") {
        const measured = parseContextUsage(parsed.payload);
        setContextUsage((current) => mergeContextUsage(current, measured));
      }
      liveCountRef.current += 1;
      const listening = `đang nghe · ${liveCountRef.current} sự kiện`;
      setLiveStatus(listening);
      onLiveStatus?.(listening);
      setLiveTurn((state) => reduceLiveTurn(state, parsed));
    },
    [activeSessionId, onLiveStatus],
  );

  // Live turn feed. The PTY-side gateway publishes every dispatcher emit to
  // `/api/events` for this chat tab's channel (see lib/chat-live-turn.ts), so
  // the chat can show the answer as it is written instead of waiting for the
  // session store to gain the finished message.
  useEffect(() => {
    // Only once the PTY child is up: it is the publisher on this channel, so
    // subscribing earlier just opens a socket nobody writes to.
    if (!enabled || !channel || connectionState !== "open") return;
    let unmounting = false;
    let socket: WebSocket | null = null;
    let retry: number | null = null;
    let attempt = 0;

    const connect = async () => {
      let url: string;
      try {
        url = await buildWsUrl("/api/events", { channel });
      } catch {
        scheduleRetry(1000);
        return;
      }
      if (unmounting) return;

      // Handler properties rather than addEventListener, matching how the
      // rest of the dashboard drives its sockets.
      const next = new WebSocket(url);
      socket = next;
      next.onopen = () => {
        attempt = 0;
      };
      next.onmessage = (event: MessageEvent) => {
        if (unmounting || typeof event.data !== "string") return;
        try {
          applyLiveFrame(JSON.parse(event.data));
        } catch {
          /* not a JSON frame — nothing this view can use */
        }
      };
      next.onclose = (event: CloseEvent) => {
        if (unmounting || socket !== next) return;
        socket = null;
        if (!shouldRetryEventsClose(event.code)) return;
        if (attempt >= EVENTS_MAX_RECONNECT_ATTEMPTS) return;
        scheduleRetry(eventsReconnectDelayMs(attempt++));
      };
    };

    function scheduleRetry(delay: number) {
      if (unmounting || retry !== null) return;
      retry = window.setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    }

    void connect();

    return () => {
      unmounting = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
      socket = null;
    };
  }, [applyLiveFrame, channel, connectionState, enabled]);

  // Second live source, and the one that carries the stream in the usual
  // setup. When the PTY child attaches to the dashboard's in-process gateway
  // (the default — `HERMES_TUI_GATEWAY_URL`), no separate `tui_gateway.entry`
  // runs, so nothing mirrors emits to `/api/pub` and the socket above stays
  // silent. The gateway does keep a per-session replay ring, and
  // `session.events.since` reads it over the same `/api/ws` the sidebar uses.
  useEffect(() => {
    if (!enabled || connectionState !== "open" || !activeSessionId) return;

    const gateway = new GatewayClient();
    gatewayRef.current = gateway;
    let stopped = false;
    let timer: number | null = null;
    let seededDelegation = false;
    liveSeqRef.current = null;
    gatewaySidRef.current = null;
    // Deferred: this effect body runs on every reconnect, and clearing the
    // mirror synchronously here cascades a render before the socket is even
    // open. The ref — which the event filter reads — is already cleared.
    void Promise.resolve().then(() => setGatewaySid(null));

    /**
     * The gateway keys a session two ways: `id` — the key of its `_sessions`
     * map, which is what every event frame is stamped with and what the replay
     * ring is filed under — and `session_key`, the agent's own session id,
     * which is what the URL, the session list and the message store all use.
     * Asking the ring for the store's id finds nothing at all: the RPC answers
     * happily with an empty list, which is exactly the "đã nối but never đang
     * nghe" symptom. `session.active_list` is what maps one to the other.
     */
    const resolveGatewaySid = async (): Promise<string | null> => {
      const response = await gateway.request<{
        sessions?: Array<{ id?: string; session_key?: string; current?: boolean }>;
      }>("session.active_list", { current_session_id: activeSessionId });
      const rows = response?.sessions ?? [];
      const match =
        rows.find((row) => row.session_key === activeSessionId) ??
        rows.find((row) => row.id === activeSessionId) ??
        rows.find((row) => row.current) ??
        rows.at(-1);
      return match?.id ?? null;
    };

    const poll = async () => {
      try {
        if (gateway.connectionState !== "open") await gateway.connect();

        if (!gatewaySidRef.current) {
          gatewaySidRef.current = await resolveGatewaySid();
          setGatewaySid(gatewaySidRef.current);
          if (stopped) return;
          if (!gatewaySidRef.current) {
            setLiveStatus("chưa khớp phiên");
            onLiveStatus?.("chưa khớp phiên");
            timer = window.setTimeout(poll, LIVE_POLL_INTERVAL_MS * 4);
            return;
          }
          liveSeqRef.current = null;

          // An approval raised before this chat opened (or before a reload)
          // already happened, so no event is coming for it — the agent is
          // just sitting there blocked. Drain the queue once on attach.
          // Setting it from the queue (rather than only when one is found)
          // also clears a card left over from the previous session, and one
          // already answered in the Terminal tab.
          try {
            const pending = await gateway.request<unknown>("approval.pending", {
              session_id: gatewaySidRef.current,
            });
            if (stopped) return;
            setApproval(parsePendingApprovals(pending)[0] ?? null);
          } catch {
            /* older gateway without the method — events still cover the rest */
          }

          // Seed the gauge from the session itself: `message.complete` only
          // arrives on the NEXT turn, so without this a reopened chat shows
          // "chưa đo được" over a session that has been running for an hour.
          try {
            const snapshot = await gateway.request<unknown>("session.usage", {
              session_id: gatewaySidRef.current,
            });
            if (stopped) return;
            const measured = parseContextUsage(snapshot);
            setContextUsage((current) => mergeContextUsage(current, measured));
          } catch {
            /* older gateway without the method — the gauge stays unknown */
          }
        }

        // Agents that started before this page opened emit no further spawn
        // events, so the room would be empty over a session with three
        // children already working. The snapshot is the recovery path — and
        // ONCE per gateway connection is exactly the right frequency: this
        // effect re-runs on mount, on a session switch and on a reconnect,
        // which is the whole set of moments the live stream can have gaps.
        // The poll around it runs every 320ms; asking there would be a dense
        // poll for something events already cover.
        if (!seededDelegation) {
          seededDelegation = true;
          try {
            const delegation =
              await gateway.request<unknown>("delegation.status");
            if (stopped) return;
            setAgentRoom((room) => applyDelegationStatus(room, delegation));
          } catch {
            /* older gateway without the method — events cover the live case */
          }
        }

        const response = await gateway.request<{
          events?: unknown[];
          latest_seq?: number;
        }>("session.events.since", {
          last_seen: liveSeqRef.current ?? 0,
          session_id: gatewaySidRef.current,
        });
        if (stopped) return;

        setLiveStatus((current) => {
          if (current.startsWith("đang nghe")) return current;
          onLiveStatus?.("đã nối");
          return "đã nối";
        });

        if (liveSeqRef.current === null) {
          // First poll only takes a watermark: replaying the whole ring would
          // re-animate turns that finished before the chat was even opened.
          liveSeqRef.current = response?.latest_seq ?? 0;
          // A ring that has never recorded anything means the id is stale (the
          // PTY respawned under a new gateway session) — look it up again.
          if (!response?.latest_seq) {
            gatewaySidRef.current = null;
            setGatewaySid(null);
          }
        } else {
          for (const frame of response?.events ?? []) applyLiveFrame(frame);
        }
      } catch (error) {
        // Best effort: an older gateway without the method, or a dropped
        // socket, just means no live text — the poll below still fills in.
        // Surfacing the reason turns a silent stream into a readable one.
        if (!stopped) {
          const message = `lỗi: ${
            error instanceof Error ? error.message : String(error)
          }`;
          setLiveStatus(message);
          onLiveStatus?.(message);
        }
      }
      if (!stopped) timer = window.setTimeout(poll, LIVE_POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      if (gatewayRef.current === gateway) gatewayRef.current = null;
      gateway.close();
    };
  }, [activeSessionId, applyLiveFrame, connectionState, enabled, onLiveStatus]);

  /**
   * Mirror the room up to the page — THROTTLED, deliberately.
   *
   * `agentRoom` is a new object on every `subagent.*` frame, and a busy child
   * emits `thinking`/`tool` continuously. Pushing each one straight into page
   * state re-renders the whole ChatPage — which hosts the transcript, the
   * terminal, the session list AND the sidebar that owns its own gateway
   * connection and sidecar session. Under a real delegation run that is
   * hundreds of full page renders a minute, and the sidebar loses its footing
   * (v2.23.0 shipped exactly that: the chat stopped resolving its session and
   * showed only the live stream).
   *
   * The sidebar card is a glance surface, so one update a second is plenty.
   * The panel inside this component keeps rendering off the unthrottled state
   * and stays instant.
   */
  const roomMirrorRef = useRef<AgentRoomState>(agentRoom);
  // Kept current by an effect rather than during render: this component may
  // re-render for reasons unrelated to the room, and writing a ref in the
  // render body is exactly what React 19 flags.
  useEffect(() => {
    roomMirrorRef.current = agentRoom;
  }, [agentRoom]);

  useEffect(() => {
    if (!onAgentRoomChange) return;
    let last: AgentRoomState | null = null;
    const push = () => {
      const room = roomMirrorRef.current;
      if (room === last) return;
      last = room;
      onAgentRoomChange(room);
    };
    push();
    const timer = window.setInterval(push, 1000);
    return () => {
      window.clearInterval(timer);
      // One final push so a room that settled between ticks is not left stale.
      push();
    };
  }, [onAgentRoomChange]);

  /**
   * One gateway RPC on this chat's existing connection.
   *
   * The panels below (pet, session tools, checkpoints) all need the gateway,
   * and opening a second socket per panel would multiply the live-event
   * traffic for no reason — so they borrow this one.
   */
  const callGateway = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}) => {
      const gateway = gatewayRef.current;
      if (!gateway) throw new Error("Chưa kết nối gateway.");
      if (gateway.connectionState !== "open") await gateway.connect();
      return gateway.request<T>(method, params);
    },
    [],
  );

  /**
   * Read one sub-agent's own transcript.
   *
   * A delegated child writes its full conversation to its own session, and
   * every relayed `subagent.*` event carries that `child_session_id`. Reading
   * it here is the safe way to see it: the chat itself must never navigate
   * onto a child session — doing that by accident is what made the main
   * conversation vanish from the Dashboard.
   */
  const loadChildTranscript = useCallback(
    async (sessionId: string) => {
      const response = await api.getSessionMessages(sessionId, profile);
      return (response.messages ?? []).map((message) => ({
        content: message.content,
        role: message.role,
      }));
    },
    [profile],
  );

  /**
   * Answer one clarify question.
   *
   * A batch is answered per `qid`; the server replies with the qids still
   * outstanding and unblocks the tool when none are left. The card is only
   * cleared once the server says nothing remains — clearing on the first
   * answer would hide the rest of the form while Hermes still waited.
   */
  const answerClarify = useCallback(
    async (question: ClarifyQuestion, draft: ClarifyDraft): Promise<boolean> => {
      const gateway = gatewayRef.current;
      if (!gateway || !clarify) return false;
      try {
        const reply = await gateway.request<{
          status?: string;
          remaining?: unknown[];
        }>("clarify.respond", buildClarifyResponse(clarify, question, draft));
        const remaining = Array.isArray(reply?.remaining) ? reply.remaining : null;
        if (!clarify.batch || (remaining && remaining.length === 0)) {
          setClarify(null);
        }
        return true;
      } catch {
        return false;
      }
    },
    [clarify],
  );

  /**
   * Stop one delegated child — `subagent.interrupt`.
   *
   * Real, and the only per-agent control Hermes offers: there is no
   * pause-one-agent call, which is why the panel has no pause button on a
   * card. The room does not mark the agent stopped itself — the runtime emits
   * `subagent.complete` with status `interrupted`, and that is what moves it.
   */
  const stopAgent = useCallback(async (agent: RoomAgent): Promise<boolean> => {
    const gateway = gatewayRef.current;
    if (!gateway || !agent.subagentId) return false;
    try {
      const reply = await gateway.request<{ found?: boolean }>(
        "subagent.interrupt",
        { subagent_id: agent.subagentId },
      );
      return reply?.found === true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Toggle `delegation.pause` — the spawn gate.
   *
   * This blocks Hermes from starting NEW children; children already running
   * are untouched. The button says so, because "tạm dừng" over a running
   * agent would be a promise the runtime cannot keep.
   */
  const pauseSpawn = useCallback(async (paused: boolean): Promise<boolean> => {
    const gateway = gatewayRef.current;
    if (!gateway) return false;
    try {
      const reply = await gateway.request<{ paused?: boolean }>(
        "delegation.pause",
        { paused },
      );
      const next = reply?.paused === true;
      setAgentRoom((room) => ({ ...room, paused: next }));
      return next;
    } catch {
      return false;
    }
  }, []);

  /**
   * Fetch the per-category context breakdown for the gauge panel.
   *
   * Only on demand: the gateway rebuilds the system prompt and estimates
   * tokens across the entire history to answer this, so it is far too heavy
   * to sit on the poll that keeps the rest of the chat live.
   */
  const requestContextBreakdown = useCallback(async (): Promise<unknown> => {
    const gateway = gatewayRef.current;
    const sid = gatewaySidRef.current;
    if (!gateway || !sid) throw new Error("chưa khớp phiên");
    return gateway.request<unknown>("session.context_breakdown", {
      session_id: sid,
    });
  }, []);

  // The configured compaction threshold, for the gauge panel. Wrapped so a
  // config read can never take the chat down — the gauge simply omits the
  // line, exactly as it does for a config that never set one.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    Promise.resolve()
      .then(() => api.getConfig(profile))
      .then((config: unknown) => {
        if (alive) setChatConfig(config);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, profile]);

  /**
   * Answer the approval the agent is blocked on. Same queue the Terminal
   * prompt resolves, addressed by `request_id`, so whichever face answers
   * first wins and the other one's copy simply disappears.
   */
  const answerApproval = useCallback(
    async (choice: ApprovalChoice) => {
      const gateway = gatewayRef.current;
      const sid = gatewaySidRef.current;
      if (!approval || !gateway || !sid || answering) return;
      setAnswering(choice);
      try {
        await gateway.request(
          "approval.respond",
          buildApprovalResponse(sid, approval, choice),
        );
        setApproval(null);
        setApprovalNote(approvalOutcomeVi(choice));
      } catch (error) {
        // Leave the card up: the agent is still blocked, so hiding the only
        // way to unblock it would be the worst possible outcome.
        setApprovalNote(
          `Chưa gửi được trả lời: ${
            error instanceof Error ? error.message : "lỗi không rõ"
          } — anh có thể trả lời ở tab Terminal.`,
        );
      } finally {
        setAnswering(null);
      }
    },
    [answering, approval],
  );

  // The gateway's catalog already lists skills, so the `/api/skills` lookup is
  // only a fallback for whatever it did not name.
  const allCommands = useMemo(() => {
    const base = catalogCommands ?? HERMES_COMMANDS;
    const known = new Set<string>();
    for (const command of base) {
      known.add(command.name.toLowerCase());
      for (const alias of command.aliases ?? []) known.add(alias.toLowerCase());
    }
    return [
      ...base,
      ...skillCommands.filter(
        (command) => !known.has(command.name.toLowerCase()),
      ),
    ];
  }, [catalogCommands, skillCommands]);

  const palette = useMemo(() => {
    if (paletteDismissed || !isCommandQuery(composer)) return [];
    return matchCommands(composer, allCommands).slice(0, PALETTE_LIMIT);
  }, [allCommands, composer, paletteDismissed]);

  const activeCommand = useMemo(
    () => commandForLine(composer, allCommands),
    [allCommands, composer],
  );

  // Clamped rather than reset from an effect: a shrinking result list must
  // not leave the highlight pointing past the end for one render.
  const activeIndex = Math.min(paletteIndex, Math.max(0, palette.length - 1));

  useEffect(() => {
    paletteActiveRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, palette.length]);

  const referenceMatches = useMemo(
    () => matchCommands(referenceQuery, allCommands),
    [allCommands, referenceQuery],
  );

  /**
   * Unfiltered, the sheet leads with the everyday commands and then groups the
   * rest by category. Filtered, ranking already carries the answer — flatten
   * it so the best match sits at the top.
   */
  const referenceGroups = useMemo(() => {
    if (referenceQuery.trim()) {
      return [{ commands: referenceMatches, key: "Kết quả", highlight: false }];
    }
    const groups: Array<{
      key: string;
      commands: HermesCommand[];
      highlight: boolean;
    }> = [];
    const common = referenceMatches.filter((command) => command.common);
    if (common.length) {
      groups.push({ commands: common, highlight: true, key: "Hay dùng" });
    }
    for (const command of referenceMatches) {
      if (command.common) continue;
      const found = groups.find((group) => group.key === command.category);
      if (found) found.commands.push(command);
      else
        groups.push({
          commands: [command],
          highlight: false,
          key: command.category,
        });
    }
    return groups;
  }, [referenceMatches, referenceQuery]);

  const acceptCommand = useCallback((command: HermesCommand) => {
    // Trailing space when the command takes arguments: it closes the palette
    // and puts the caret where the argument goes.
    setComposer(`/${command.name}${command.args ? " " : ""}`);
    setPaletteDismissed(false);
    setReferenceOpen(false);
    textareaRef.current?.focus();
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stickToBottomRef.current = true;
    setPinnedToBottom(true);
    viewport.scrollTop = viewport.scrollHeight;
  }, []);

  const attachFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      setNotice(null);
      try {
        const uploaded = await onAttachFiles(files);
        for (const item of uploaded) {
          if (item.previewUrl) previewUrlsRef.current.add(item.previewUrl);
        }
        setAttachments((current) => [...current, ...uploaded]);
        scrollToBottom();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onAttachFiles, scrollToBottom],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((current) => {
        const target = current.find((item) => item.id === id);
        if (target) forgetPreview(target);
        return current.filter((item) => item.id !== id);
      });
    },
    [forgetPreview],
  );

  const submit = useCallback(() => {
    if (busy || !connected) return;
    const value = composer.trim();
    const pending = attachments;
    if (!value && pending.length === 0) return;

    const command = commandForLine(value, allCommands);

    setSending(true);
    setNotice(null);
    void onSubmit(value, pending)
      .then((warning) => {
        // Pickers (/model, /skills, …) draw inside the TUI, which only the
        // Terminal view shows — follow the command over there.
        if (command?.needsTerminal) onNeedsTerminal?.();
        for (const item of pending) forgetPreview(item);
        setComposer("");
        setAttachments([]);
        setMayDiscoverSession(true);
        setAwaitingReply(true);
        scrollToBottom();
        if (warning) setNotice(warning);
        window.setTimeout(() => void loadConversation(), 200);
      })
      .catch((error: unknown) => {
        // Keep the text and the attachments so the turn can be retried.
        setNotice(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setSending(false));
  }, [
    attachments,
    busy,
    composer,
    connected,
    allCommands,
    forgetPreview,
    loadConversation,
    onNeedsTerminal,
    onSubmit,
    scrollToBottom,
  ]);

  const canSend =
    connected && !busy && (composer.trim().length > 0 || attachments.length > 0);

  return (
    <section
      className={cn("hermes-command-conversation", dragActive && "is-dropping")}
      onDragEnter={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        void attachFiles(filesFromTransfer(event.dataTransfer));
      }}
    >
      <div className="hermes-command-live-state" title="Trạng thái luồng trực tiếp">
        {liveStatus}
      </div>

      {/* Above the transcript, and only when there is something to show: with
          no sub-agents the chat keeps exactly the layout it had, with no
          reserved gap. */}
      {hasAgents(agentRoom) ? (
        <AgentRoom
          room={agentRoom}
          onStopAgent={connected ? stopAgent : undefined}
          onPauseSpawn={connected ? pauseSpawn : undefined}
          onLoadChildTranscript={loadChildTranscript}
          disconnected={!connected && liveAgents(agentRoom).length > 0}
        />
      ) : null}

      <div className="hermes-command-drawer-tabs">
        <button
          type="button"
          className={cn(drawer === "tools" && "is-active")}
          onClick={() => setDrawer((current) => (current === "tools" ? "" : "tools"))}
        >
          <Wrench className="h-3.5 w-3.5" />
          Công cụ phiên
        </button>
        <button
          type="button"
          className={cn(drawer === "checkpoints" && "is-active")}
          onClick={() =>
            setDrawer((current) => (current === "checkpoints" ? "" : "checkpoints"))
          }
        >
          <History className="h-3.5 w-3.5" />
          Checkpoint
        </button>
      </div>

      <div
        ref={viewportRef}
        className="hermes-command-conversation-viewport"
        onScroll={(event) => {
          const target = event.currentTarget;
          const pinned =
            target.scrollHeight - target.scrollTop - target.clientHeight <
            STICK_TO_BOTTOM_PX;
          stickToBottomRef.current = pinned;
          setPinnedToBottom(pinned);
        }}
      >
        {initialLoading ? (
          <div className="hermes-command-chat-state">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>Đang khôi phục cuộc trò chuyện…</span>
          </div>
        ) : loadError && messages.length === 0 ? (
          <div className="hermes-command-chat-state is-error">
            <span>Không tải được lịch sử: {loadError}</span>
            <Button size="sm" outlined onClick={() => void loadConversation()}>
              Thử lại
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <div className="hermes-command-chat-empty">
            <Bot className="h-8 w-8" />
            <strong>Hermes đã sẵn sàng</strong>
            <span>Nhập nhiệm vụ, kéo thả tệp hoặc dán ảnh vào khung bên dưới.</span>
            <div className="hermes-command-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setComposer(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="hermes-command-message-list">
            {transcript.map((item) =>
              item.kind === "tools" ? (
                <ToolCallGroup key={item.key} calls={item.calls} />
              ) : (
                <MessageCard key={item.key} message={item.message} />
              ),
            )}
            {/* A finished turn with nothing to show — a tool-only reply, or
                syncing off — would otherwise leave an empty "vừa xong" card
                sitting in the transcript until the store happens to catch up. */}
            {liveTurn.active &&
            (!liveTurn.done || liveTurn.text || liveTurn.error) ? (
              <article className="hermes-command-message is-assistant is-live">
                <header>
                  <span className="hermes-command-message-avatar">
                    <Bot className="h-4 w-4" />
                  </span>
                  <strong>Hermes</strong>
                  <span className="hermes-command-live-badge">
                    {liveTurn.done ? "vừa xong" : "đang trả lời"}
                  </span>
                </header>
                {syncTerminal && liveTurn.text ? (
                  <Markdown content={liveTurn.text} />
                ) : null}
                {liveTurn.error ? (
                  <div className="hermes-command-live-error">
                    {liveTurn.error}
                  </div>
                ) : null}
                {liveTurn.stalled ? (
                  // Hermes's own watchdog says nothing is moving. A cute line
                  // rotating on top of that is worse than no line at all.
                  <div className="hermes-command-live-stalled">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    <span>{liveTurn.stalled}</span>
                    <button type="button" onClick={onStop}>
                      Dừng lượt này
                    </button>
                  </div>
                ) : null}
                {!liveTurn.done && !liveTurn.stalled ? (
                  <div className="hermes-command-live-status">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    {liveTurn.tool
                      ? `Đang chạy công cụ ${liveTurn.tool}…`
                      : syncTerminal
                        ? liveTurn.thinking
                          ? "Đang suy nghĩ…"
                          : liveTurn.text
                            ? "Đang viết…"
                            : "Đang xử lý nhiệm vụ…"
                        : waitingLineAt(waitingSeed, waitingTick)}
                    {!syncTerminal && liveTurn.text ? (
                      <em>đã viết {liveTurn.text.length} chữ</em>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ) : awaitingReply ? (
              <div className="hermes-command-thinking">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Hermes đang xử lý nhiệm vụ…
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!pinnedToBottom && messages.length > 0 ? (
        <button
          type="button"
          className="hermes-command-jump"
          onClick={scrollToBottom}
          aria-label="Cuộn xuống tin nhắn mới nhất"
        >
          <SquareArrowDown className="h-4 w-4" />
          Tin nhắn mới nhất
        </button>
      ) : null}

      {sideAnswers.length ? (
        <div className="hermes-side-answers">
          {sideAnswers.map((answer) => (
            <article
              key={answer.taskId}
              className={cn("hermes-side-answer", answer.failed && "is-bad")}
            >
              <header>
                <HelpCircle className="h-3.5 w-3.5" />
                <strong>
                  {answer.kind === "btw" ? "Hỏi thêm" : "Hỏi nền"}
                </strong>
                {answer.question ? <em>{answer.question}</em> : null}
                <button
                  type="button"
                  aria-label="Bỏ qua"
                  onClick={() =>
                    setSideAnswers((current) =>
                      current.filter((entry) => entry.taskId !== answer.taskId),
                    )
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </header>
              <Markdown content={answer.text} />
              {/* Not written into the session history by design, so say so —
                  otherwise it reads like a message Hermes will remember. */}
              <footer>Câu này không nằm trong hội thoại — Hermes sẽ không nhớ nó.</footer>
            </article>
          ))}
        </div>
      ) : null}

      {drawer && (gatewaySid ?? activeSessionId) ? (
        <div className="hermes-command-drawer">
          {drawer === "tools" ? (
            <SessionTools
              call={callGateway}
              sessionId={(gatewaySid ?? activeSessionId) as string}
              running={liveTurn.active && !liveTurn.done}
              hasHistory={messages.length > 0}
              // Deliberately no auto-navigation. A branch is a peer
              // conversation, not a continuation — it shows up in the session
              // list and the user opens it when they want it. Swapping the
              // chat underneath them is the failure this Dashboard already
              // fixed once.
              onHistoryChanged={() => void loadConversation()}
            />
          ) : (
            <CheckpointsPanel
              call={callGateway}
              sessionId={(gatewaySid ?? activeSessionId) as string}
              onHistoryChanged={() => void loadConversation()}
            />
          )}
        </div>
      ) : null}

      <PetCorner
        call={callGateway}
        changeTick={petTick}
        activity={{
          awaitingInput: !!approval || !!clarify,
          busy: liveTurn.active && !liveTurn.done,
          error: !!liveTurn.error,
          justCompleted: liveTurn.active && liveTurn.done,
          reasoning: liveTurn.thinking,
          toolRunning: !!liveTurn.tool,
        }}
      />

      <div className="hermes-command-composer">
        {/* Above the approval card: both block the turn, but a clarify is the
            one Hermes will sit on indefinitely by default. */}
        {clarify ? (
          <ClarifyCard request={clarify} onAnswer={answerClarify} />
        ) : null}
        {approval ? (
          <div
            className={cn("hermes-approval", `is-${approval.risk}`)}
            role="alertdialog"
            aria-label="Hermes xin quyền chạy lệnh"
          >
            <div className="hermes-approval-head">
              <TriangleAlert className="h-4 w-4" />
              <div>
                <strong>Hermes xin phép chạy lệnh này</strong>
                <p>{approval.vi}</p>
              </div>
            </div>

            <pre className="hermes-approval-command">
              <code>{splitCommandPreview(approval.command).shown}</code>
              {splitCommandPreview(approval.command).hidden ? (
                <span>
                  … còn {splitCommandPreview(approval.command).hidden} dòng nữa —
                  xem đầy đủ ở tab Terminal
                </span>
              ) : null}
            </pre>

            {approval.description &&
            approval.description !== approval.vi ? (
              <p className="hermes-approval-origin">{approval.description}</p>
            ) : null}

            <div className="hermes-approval-choices">
              {approval.choices.map((choice) => {
                const note = APPROVAL_CHOICE_VI[choice];
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={answering !== null}
                    className={cn(
                      choice === "deny" && "is-deny",
                      choice === "always" && "is-always",
                    )}
                    onClick={() => void answerApproval(choice)}
                    title={note.vi}
                  >
                    {answering === choice ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    <span>{note.label}</span>
                    <em>{note.vi}</em>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {approvalNote ? (
          <p className="hermes-approval-note">
            <Info className="h-3.5 w-3.5" />
            {approvalNote}
          </p>
        ) : null}

        {palette.length ? (
          <div className="hermes-command-palette" role="listbox" aria-label="Lệnh Hermes">
            <div className="hermes-command-palette-head">
              <span>Lệnh Hermes · {palette.length}</span>
              <span>
                <ChevronsUpDown className="h-3 w-3" /> chọn · Tab dùng · Esc đóng
              </span>
            </div>
            <div className="hermes-command-palette-list">
              {palette.map((command, index) => (
                <button
                  key={`${command.category}-${command.name}`}
                  ref={index === activeIndex ? paletteActiveRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(index === activeIndex && "is-active")}
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => acceptCommand(command)}
                >
                  <span className="hermes-command-palette-name">
                    /{command.name}
                    {command.args ? <em>{command.args}</em> : null}
                  </span>
                  <span className="hermes-command-palette-desc">
                    {command.vi}
                  </span>
                  <span className="hermes-command-palette-cat">
                    {command.common ? "★ " : ""}
                    {command.category}
                    {command.source === "gateway" ? (
                      <em className="hermes-command-new">mới</em>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {activeCommand && !palette.length ? (
          <div className="hermes-command-hint">
            <span className="hermes-command-hint-name">/{activeCommand.name}</span>
            <span>{activeCommand.vi}</span>
            {activeCommand.needsTerminal ? (
              <strong>· mở bảng chọn, sẽ chuyển sang Terminal</strong>
            ) : null}
          </div>
        ) : null}

        {attachments.length ? (
          <div className="hermes-command-attachments">
            {attachments.map((attachment) => (
              <AttachmentCard
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        ) : null}

        {!connected ? (
          <div className="hermes-command-connecting">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            <span>
              {connectionState === "reconnecting" || connectionState === "closed"
                ? "Mất kết nối tới phiên Hermes — đang thử lại…"
                : "Đang mở phiên trong Hermes… gửi được ngay khi phiên sẵn sàng."}
            </span>
          </div>
        ) : null}

        {uploading ? (
          <div className="hermes-command-upload-progress">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Đang tải tệp lên máy chủ Hermes…
          </div>
        ) : null}

        {notice ? (
          <div className="hermes-command-upload-error">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Đóng cảnh báo"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={composer}
          onChange={(event) => {
            setComposer(event.target.value);
            setPaletteDismissed(false);
            setPaletteIndex(0);
          }}
          onKeyDown={(event) => {
            if (palette.length) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setPaletteIndex((index) => (index + 1) % palette.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setPaletteIndex(
                  (index) => (index - 1 + palette.length) % palette.length,
                );
                return;
              }
              if (event.key === "Tab" || event.key === "Enter") {
                event.preventDefault();
                acceptCommand(palette[activeIndex] ?? palette[0]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setPaletteDismissed(true);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === "Escape" && (sending || awaitingReply)) {
              event.preventDefault();
              onStop();
              setAwaitingReply(false);
            }
          }}
          onPaste={(event) => {
            const files = filesFromTransfer(event.clipboardData);
            if (!files.length) return;
            event.preventDefault();
            void attachFiles(files);
          }}
          placeholder={
            connected
              ? "Nhập yêu cầu cho Hermes… gõ / để xem danh sách lệnh"
              : "Đang kết nối tới Hermes…"
          }
          rows={2}
          disabled={!connected}
        />

        <div className="hermes-command-composer-footer">
          <div className="hermes-command-composer-tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) =>
                void attachFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
            <Button
              ghost
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || !connected}
              prefix={
                uploading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )
              }
            >
              {uploading ? "Đang tải…" : "Đính kèm"}
            </Button>
            <Button
              ghost
              size="sm"
              onClick={() => {
                setReferenceOpen((open) => !open);
                setReferenceQuery("");
              }}
              aria-expanded={referenceOpen}
              prefix={<BookOpen className="h-4 w-4" />}
            >
              Chi tiết lệnh Hermes
            </Button>
            <ContextGauge
              usage={contextUsage}
              onBreakdown={requestContextBreakdown}
              config={chatConfig}
            />
            {onSwitchModel ? (
              <FavoriteModelSwitch
                onSwitch={onSwitchModel}
                onModelChanged={onModelChanged}
                disabled={!connected}
                profile={profile}
              />
            ) : null}
            <span>
              {attachments.length
                ? `${attachments.length} tệp đính kèm · Enter để gửi`
                : "Kéo thả tệp hoặc dán ảnh vào đây"}
            </span>
          </div>
          <div className="hermes-command-composer-actions">
            <Button
              outlined
              disabled={!connected}
              onClick={() => {
                onStop();
                setAwaitingReply(false);
              }}
              prefix={<CircleStop className="h-4 w-4" />}
              className="hermes-command-stop"
              title="Dừng lượt Hermes đang chạy (Ctrl+C)"
            >
              Dừng
            </Button>
            <Button
              onClick={submit}
              disabled={!canSend}
              prefix={
                sending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )
              }
            >
              {sending ? "Đang gửi…" : "Gửi"}
            </Button>
          </div>
        </div>
      </div>

      {referenceOpen ? (
        <div
          className="hermes-command-reference"
          role="dialog"
          aria-label="Chi tiết lệnh Hermes"
        >
          <header>
            <div>
              <strong>Chi tiết lệnh Hermes</strong>
              <span>
                {referenceMatches.length}/{allCommands.length} lệnh · bấm một
                dòng để đưa vào ô soạn
                {catalogNote ? ` · ${catalogNote}` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReferenceOpen(false)}
              aria-label="Đóng bảng lệnh"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <label className="hermes-command-reference-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={referenceQuery}
              onChange={(event) => setReferenceQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setReferenceOpen(false);
                }
              }}
              placeholder="Tìm theo tên lệnh hoặc theo việc muốn làm…"
              autoFocus
            />
            {referenceQuery ? (
              <button
                type="button"
                onClick={() => setReferenceQuery("")}
                aria-label="Xoá tìm kiếm"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </label>

          <div className="hermes-command-reference-body">
            {referenceMatches.length === 0 ? (
              <p className="hermes-command-reference-empty">
                Không có lệnh nào khớp “{referenceQuery}”.
              </p>
            ) : (
              referenceGroups.map((group) => (
                <section
                  key={group.key}
                  className={cn(group.highlight && "is-common")}
                >
                  <h3>
                    {group.key}
                    <em>{group.commands.length}</em>
                  </h3>
                  {group.commands.map((command) => (
                    <ReferenceRow
                      key={`${command.category}-${command.name}`}
                      command={command}
                      onSelect={acceptCommand}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}

      {dragActive ? (
        <div className="hermes-command-dropzone">
          <Paperclip className="h-6 w-6" />
          <strong>Thả tệp để đính kèm</strong>
          <span>Ảnh gửi thẳng cho Hermes, tài liệu lưu vào Hermes Files</span>
        </div>
      ) : null}
    </section>
  );
}
