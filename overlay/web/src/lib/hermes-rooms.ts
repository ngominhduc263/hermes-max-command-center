/**
 * "Nhóm" — Hermes v0.21.0's hosted rooms (Group Chats).
 *
 * v0.21.0's headline feature: several Hermes gateways, possibly on different
 * machines, share a room with a durable event log, replication, and a fenced
 * takeover when the authority gateway dies. Eighteen new RPCs, ~3,200 lines of
 * new code — and no web UI at all. The desktop app got a plugin; the Dashboard
 * got nothing.
 *
 * It adds **no REST endpoints**: everything is JSON-RPC on `/api/ws`, which is
 * the socket the Dashboard already speaks. So reading it costs almost nothing.
 *
 * ── A correction to what this file used to say ──────────────────────────
 *
 * v2.21.0 shipped this read-only, on the reasoning that `groups.capabilities`
 * implied the protocol was still moving and that "create/send/approve/retry are
 * where the churn will land". Reading the implementation properly says
 * otherwise: there is not a single TODO, FIXME, experimental marker or feature
 * flag anywhere in the hosted-room modules, the validation is exact-field and
 * unforgiving, and the write path carries idempotency and authority fencing.
 * It reads as finished code.
 *
 * The one genuine exception is authority takeover — `groups.promote` /
 * `groups.demote`. `gateway/hosted_room_replicas.py` says so itself: "an
 * explicit user action today; a lease/quorum driver later". That pair stays
 * unbuilt; everything else is safe to drive.
 *
 * ── What a room actually needs ──────────────────────────────────────────
 *
 * Two calls: `groups.create` then `groups.send`. Sending is what starts the
 * discussion — it wakes the driver, which is already running (the gateway
 * starts the hosted-room worker at boot and supervises it every second).
 *
 * Members are just Hermes profiles on this machine. Peer members, room-link
 * grants and cross-machine setup are all optional — `room_link.enabled: false`
 * blocks none of it. Only `target.kind === "peer"` needs any of that.
 *
 * A discussion is BOUNDED, and the UI should say so rather than implying an
 * endless chat: 2–6 members, at most 3 rounds and 10 messages, each member
 * seeing the last 24 lines. When it runs out it closes itself with a
 * `room.activity` event carrying `status` (settled/bounded) and a reason code.
 *
 * Every shape below is read off the actual handlers, not guessed:
 *   gateway/hosted_rooms.py  `_room_from_row`, `_event_from_row`, `read_events`
 *   tui_gateway/methods_groups.py  groups.capabilities / list / state / log
 *   tui_gateway/hosted_room_service.py  `status()`
 *
 *   room   = {room_id, name, members[], authority_gateway_id, authority_epoch,
 *             revision, created_at, updated_at, latest_seq?, disbanded_at?}
 *   member = {member_id, profile, handle, ...}   (free-form beyond that)
 *   event  = {room_id, seq, event_id, kind, actor{kind,id,display_name?},
 *             authority_epoch, payload, created_at}
 *   log    = {events[], cursor, latest_seq, has_more, authority{gateway_id,epoch}}
 *
 * Timestamps are float seconds (`time.time()`), not milliseconds.
 */

export interface RoomMember {
  id: string;
  label: string;
  /** Which Hermes profile answers for this member, when the room said. */
  profile: string;
}

export interface Room {
  roomId: string;
  name: string;
  members: RoomMember[];
  /** Which gateway currently holds authority over the room. */
  authorityGatewayId: string;
  /** Bumped on every takeover — a high number means authority moved a lot. */
  authorityEpoch: number;
  revision: number;
  /** Sequence of the newest event in the log, when the row carried it. */
  latestSeq: number | null;
  /** Seconds since the epoch, as the gateway stores them. */
  createdAt: number | null;
  updatedAt: number | null;
  disbanded: boolean;
}

export interface RoomEvent {
  seq: number;
  eventId: string;
  kind: string;
  /** `actor.id` — who appended the event. */
  actor: string;
  /** `actor.kind`: user | member | gateway | system. */
  actorKind: string;
  /** `actor.display_name` when set, else the id. */
  actorLabel: string;
  payload: unknown;
  createdAt: number | null;
  /* ── Discussion coordinates, present on message.member and turn.* ──
     Exact field sets: `_MEMBER_MESSAGE_FIELDS` and `_TERMINAL_COMMON_FIELDS`
     in gateway/hosted_room_discussion.py. */
  /** Which member spoke or was being run. */
  memberId: string;
  /** 0-based round. A discussion runs at most 3. */
  roundIndex: number | null;
  /** The member's own words, on `message.member`. */
  memberText: string;
  /** `turn.settled` only: the member deliberately said nothing. */
  passed: boolean;
  /** `turn.failed` error, `turn.cancelled`/`turn.deferred` reason. */
  detail: string;
  /** `room.activity` only: "settled" | "bounded", plus its reason code. */
  activityStatus: string;
  activityReason: string;
}

export interface RoomLogPage {
  events: RoomEvent[];
  /** Newest sequence this page reached — the cursor for the next read. */
  cursor: number;
  /** Newest sequence in the room, which may be beyond this page. */
  latestSeq: number;
  hasMore: boolean;
}

/** `driver_status` from `groups.state`, when the driver is running here. */
export interface RoomDriverStatus {
  running: boolean;
  /** A turn is queued or in flight. */
  working: boolean;
  /** Something needs a person: an indeterminate turn, or a blocked room. */
  blocked: boolean;
  /** Task counts by status. */
  counts: Record<string, number>;
  /** Retries/approvals waiting — this page only counts them. */
  pendingActions: number;
}

export interface RoomState {
  room: Room | null;
  driver: RoomDriverStatus | null;
}

export interface RoomCapabilities {
  available: boolean;
  /** Protocol version this gateway implements, when it said. */
  protocolVersion: string | null;
  /** The room driver is running in this gateway process. */
  driverReady: boolean;
  /** Cross-gateway linking is configured. */
  roomLinkEnabled: boolean;
  /** Why linking is off, in Vietnamese, when the gateway gave a reason. */
  reason: string;
  /** This gateway's stable install identity. */
  authorityGatewayId: string;
  /** `groups.*` methods this gateway serves. */
  methods: string[];
  maxLogLimit: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Members are free-form JSON — the gateway only insists each one is an object.
 * `_create_room` writes `{member_id, profile, handle}`; older rooms and other
 * clients may write less. Flatten to something renderable without inventing
 * structure that isn't there, and accept a bare string id too.
 */
export function parseMembers(raw: unknown): RoomMember[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomMember[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ id: item.trim(), label: item.trim(), profile: "" });
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const id = (
      text(record.member_id) ||
      text(record.id) ||
      text(record.handle) ||
      ""
    ).trim();
    if (!id) continue;
    const label =
      text(record.handle).trim() ||
      text(record.display_name).trim() ||
      text(record.label).trim() ||
      text(record.name).trim() ||
      id;
    out.push({ id, label, profile: text(record.profile).trim() });
  }
  return out;
}

export function parseRoom(raw: unknown): Room | null {
  const record = asRecord(raw);
  if (!record) return null;
  const roomId = text(record.room_id).trim();
  if (!roomId) return null;

  return {
    authorityEpoch: num(record.authority_epoch) ?? 0,
    authorityGatewayId: text(record.authority_gateway_id),
    createdAt: num(record.created_at),
    disbanded: record.disbanded_at != null,
    latestSeq: num(record.latest_seq),
    members: parseMembers(record.members),
    name: text(record.name).trim() || roomId,
    revision: num(record.revision) ?? 0,
    roomId,
    updatedAt: num(record.updated_at),
  };
}

/** Rooms from a `groups.list` reply, newest activity first. */
export function parseRoomList(response: unknown): Room[] {
  const record = asRecord(response);
  const rows = Array.isArray(record?.rooms) ? record.rooms : [];
  const rooms: Room[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const room = parseRoom(row);
    if (!room || seen.has(room.roomId)) continue;
    seen.add(room.roomId);
    rooms.push(room);
  }
  return rooms.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function parseDriverStatus(raw: unknown): RoomDriverStatus | null {
  const record = asRecord(raw);
  if (!record) return null;
  const counts: Record<string, number> = {};
  const rawCounts = asRecord(record.counts);
  if (rawCounts) {
    for (const [key, value] of Object.entries(rawCounts)) {
      const count = num(value);
      if (count !== null) counts[key] = count;
    }
  }
  return {
    blocked: record.blocked === true,
    counts,
    pendingActions: Array.isArray(record.pending_actions)
      ? record.pending_actions.length
      : 0,
    running: record.running === true,
    working: record.working === true,
  };
}

/**
 * `groups.state` wraps the room: `{room, driver_status?}`. `driver_status` is
 * absent for a disbanded room, and for a gateway that is not the authority.
 */
export function parseRoomState(response: unknown): RoomState {
  const record = asRecord(response);
  if (!record) return { driver: null, room: null };
  return {
    driver: parseDriverStatus(record.driver_status),
    room: parseRoom(record.room),
  };
}

export function parseRoomEvent(raw: unknown): RoomEvent | null {
  const record = asRecord(raw);
  if (!record) return null;
  const seq = num(record.seq);
  if (seq === null) return null;

  const actorRecord = asRecord(record.actor);
  const actor = actorRecord ? text(actorRecord.id) : text(record.actor);
  const actorLabel = actorRecord
    ? text(actorRecord.display_name).trim() || actor
    : actor;

  const payload = asRecord(record.payload);
  const kind = text(record.kind) || "?";

  return {
    actor,
    actorKind: actorRecord ? text(actorRecord.kind) : "",
    actorLabel,
    activityReason: kind === "room.activity" ? text(payload?.reason_code) : "",
    activityStatus: kind === "room.activity" ? text(payload?.status) : "",
    createdAt: num(record.created_at),
    detail:
      text(payload?.error) || (kind === "room.activity" ? "" : text(payload?.reason)),
    eventId: text(record.event_id),
    kind,
    memberId: text(payload?.member_id),
    memberText: text(payload?.text),
    passed: payload?.passed === true,
    payload: record.payload,
    roundIndex: num(payload?.round_index),
    seq,
  };
}

/* ── The discussion, as something renderable ─────────────────────────────── */

export interface DiscussionTurn {
  seq: number;
  /** "you" for the person's own message, "member" for an agent. */
  who: "you" | "member";
  /** Member handle when known, else the raw member id. */
  label: string;
  memberId: string;
  text: string;
  roundIndex: number | null;
  createdAt: number | null;
  /** The member was given the turn and chose not to speak. */
  passed: boolean;
  /** A turn that ended badly — the reason, in Vietnamese. */
  problem: string;
}

/** How a discussion ended, when it has. */
export interface DiscussionOutcome {
  status: "settled" | "bounded";
  vi: string;
}

export interface RoomDiscussion {
  turns: DiscussionTurn[];
  outcome: DiscussionOutcome | null;
  /** Highest round seen, so the UI can say "vòng 2/3". */
  rounds: number;
}

/**
 * Why a discussion stopped. These codes come from `plan_next_task`.
 *
 * A bounded discussion is not a failure — it is the design. Saying so plainly
 * matters, because "hết lượt" reads like something broke otherwise.
 */
const DISCUSSION_REASON_VI: Record<string, string> = {
  max_messages: "đủ 10 tin nhắn — mức tối đa của một lượt thảo luận",
  max_rounds: "đủ 3 vòng — mức tối đa của một lượt thảo luận",
  silent_round: "không ai còn gì để nói thêm",
};

const TURN_PROBLEM_VI: Record<string, string> = {
  "turn.cancelled": "lượt bị huỷ",
  "turn.deferred": "lượt bị hoãn — cần bấm Thử lại",
  "turn.failed": "lượt thất bại",
};

/**
 * Fold a room log into the conversation a person actually wants to read.
 *
 * The log is an event stream with bookkeeping in it: every member message is
 * followed by a `turn.settled`, and a member who passes leaves only the
 * terminal event. This keeps the words, attaches the problems to the turn they
 * belong to, and drops the plumbing.
 */
export function buildDiscussion(
  events: RoomEvent[],
  members: RoomMember[],
): RoomDiscussion {
  const labelOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.label || memberId;

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const turns: DiscussionTurn[] = [];
  let outcome: DiscussionOutcome | null = null;
  let rounds = 0;

  for (const event of ordered) {
    if (event.roundIndex !== null) rounds = Math.max(rounds, event.roundIndex + 1);

    if (event.kind === "message.user") {
      turns.push({
        createdAt: event.createdAt,
        label: "Anh",
        memberId: "",
        passed: false,
        problem: "",
        roundIndex: null,
        seq: event.seq,
        text: event.memberText,
        who: "you",
      });
      continue;
    }

    if (event.kind === "message.member") {
      turns.push({
        createdAt: event.createdAt,
        label: labelOf(event.memberId),
        memberId: event.memberId,
        passed: false,
        problem: "",
        roundIndex: event.roundIndex,
        seq: event.seq,
        text: event.memberText,
        who: "member",
      });
      continue;
    }

    if (event.kind === "turn.settled") {
      // A settled turn adds nothing unless the member passed — the words
      // already arrived as `message.member`.
      if (!event.passed) continue;
      turns.push({
        createdAt: event.createdAt,
        label: labelOf(event.memberId),
        memberId: event.memberId,
        passed: true,
        problem: "",
        roundIndex: event.roundIndex,
        seq: event.seq,
        text: "",
        who: "member",
      });
      continue;
    }

    if (TURN_PROBLEM_VI[event.kind]) {
      const reason = TURN_PROBLEM_VI[event.kind];
      turns.push({
        createdAt: event.createdAt,
        label: labelOf(event.memberId),
        memberId: event.memberId,
        passed: false,
        problem: event.detail ? `${reason}: ${event.detail}` : reason,
        roundIndex: event.roundIndex,
        seq: event.seq,
        text: "",
        who: "member",
      });
      continue;
    }

    if (event.kind === "room.activity") {
      const status = event.activityStatus === "bounded" ? "bounded" : "settled";
      const why =
        DISCUSSION_REASON_VI[event.activityReason] ?? event.activityReason;
      outcome = {
        status,
        vi:
          status === "bounded"
            ? `Thảo luận dừng vì ${why || "chạm giới hạn"}.`
            : `Thảo luận kết thúc — ${why || "xong"}.`,
      };
    }
  }

  return { outcome, rounds, turns };
}

/**
 * A `groups.log` page. The gateway returns events oldest-first with a cursor;
 * this flips them newest-first for display and keeps the cursor as it was, so
 * a caller paging backwards still has the number the gateway gave it.
 */
export function parseRoomLog(response: unknown): RoomLogPage {
  const record = asRecord(response);
  const rows = Array.isArray(record?.events) ? record.events : [];
  const events: RoomEvent[] = [];
  for (const row of rows) {
    const event = parseRoomEvent(row);
    if (event) events.push(event);
  }
  events.sort((a, b) => b.seq - a.seq);
  return {
    cursor: num(record?.cursor) ?? events[0]?.seq ?? 0,
    events,
    hasMore: record?.has_more === true,
    latestSeq: num(record?.latest_seq) ?? events[0]?.seq ?? 0,
  };
}

/**
 * Why cross-gateway linking is off. The gateway returns a bare code, not a
 * sentence — these are the two `groups.capabilities` emits.
 */
const ROOM_LINK_REASON_VI: Record<string, string> = {
  durable_run_storage_required:
    "Cần bộ nhớ chống trùng lặp bền vững thì mới nối được nhiều máy.",
  gateway_roomlink_secret_unavailable:
    "Gateway chưa có khoá bí mật để nối phòng giữa các máy.",
};

/**
 * Read `groups.capabilities`. A gateway older than v0.21.0 has no such method
 * at all — the caller turns that rejection into `{available: false}`, which is
 * why this only has to describe a reply that did arrive.
 */
export function parseRoomCapabilities(response: unknown): RoomCapabilities {
  const record = asRecord(response);
  if (!record) {
    return {
      authorityGatewayId: "",
      available: false,
      driverReady: false,
      maxLogLimit: null,
      methods: [],
      protocolVersion: null,
      reason: "Gateway không trả lời được về tính năng Nhóm.",
      roomLinkEnabled: false,
    };
  }

  const roomLink = asRecord(record.room_link);
  const version = num(record.protocol_version);
  const reasonCode = text(roomLink?.reason) || text(record.reason);

  return {
    authorityGatewayId: text(record.authority_gateway_id),
    available: true,
    // The handler calls it `driver`; `driver_ready` is accepted in case the
    // field is renamed to match the rest of the reply.
    driverReady: record.driver === true || record.driver_ready === true,
    maxLogLimit: num(record.max_log_limit),
    methods: Array.isArray(record.methods)
      ? record.methods.filter((entry): entry is string => typeof entry === "string")
      : [],
    protocolVersion:
      version !== null ? String(version) : text(record.protocol_version) || null,
    reason: reasonCode ? (ROOM_LINK_REASON_VI[reasonCode] ?? reasonCode) : "",
    roomLinkEnabled: roomLink?.enabled === true,
  };
}

/**
 * Vietnamese label for every event kind the log can hold.
 * Source of truth: `_EVENT_KINDS_BY_ACTOR` in gateway/hosted_rooms.py.
 */
export const ROOM_EVENT_VI: Record<string, string> = {
  "authority.claimed": "Gateway này nhận quyền điều phối phòng",
  "authority.lost": "Mất quyền điều phối phòng",
  "member.unavailable": "Một thành viên không trả lời được",
  "message.member": "Tin nhắn của thành viên",
  "message.user": "Tin nhắn của người dùng",
  "room.activity": "Hoạt động trong phòng",
  "room.created": "Phòng được tạo",
  "room.disbanded": "Phòng bị giải tán",
  "room.members_changed": "Danh sách thành viên thay đổi",
  "room.renamed": "Phòng được đổi tên",
  "room.stop_requested": "Có yêu cầu dừng phòng",
  "turn.cancelled": "Lượt bị huỷ",
  "turn.deferred": "Lượt bị hoãn lại",
  "turn.failed": "Lượt thất bại",
  "turn.reassigned": "Lượt được giao cho thành viên khác",
  "turn.settled": "Lượt hoàn tất",
  "turn.started": "Lượt bắt đầu",
};

export function roomEventVi(kind: string): string {
  return ROOM_EVENT_VI[kind] ?? kind;
}

/** A short, readable form of an event payload for the log list. */
export function roomEventSummary(event: RoomEvent): string {
  const payload = asRecord(event.payload);
  if (!payload) {
    return typeof event.payload === "string" ? event.payload : "";
  }
  const candidate =
    text(payload.text) ||
    text(payload.message) ||
    text(payload.name) ||
    text(payload.reason);
  if (candidate) {
    return candidate.length > 160 ? `${candidate.slice(0, 160)}…` : candidate;
  }
  const keys = Object.keys(payload);
  return keys.length ? `(${keys.join(", ")})` : "";
}

/** Seconds-since-epoch to a local time string; blank when there is none. */
export function roomTimeVi(seconds: number | null): string {
  if (seconds === null) return "";
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/* ── Building a roster the gateway will accept ───────────────────────────── */

/**
 * The real limits, from `gateway/hosted_room_discussion.py`.
 *
 * Mirrored here so the UI can refuse an impossible roster before sending it,
 * with a message in Vietnamese instead of a raw `DiscussionValidationError`.
 * The gateway still validates — this is a courtesy, never the authority.
 */
export const MIN_ROOM_MEMBERS = 2;
export const MAX_ROOM_MEMBERS = 6;
export const MAX_DISCUSSION_ROUNDS = 3;
export const MAX_DISCUSSION_MESSAGES = 10;

/** `_IDENTIFIER_RE` — the gateway rejects anything else outright. */
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Handles the gateway reserves for "@everyone". */
const RESERVED_HANDLES = new Set(["all", "everyone"]);

export interface DraftMember {
  /** The Hermes profile that answers for this member. */
  profile: string;
  /** What other members type to address them: `@handle`. */
  handle: string;
}

/**
 * Turn a profile name into a legal handle.
 *
 * Profiles can be named anything; handles cannot. Strip to the allowed
 * character set rather than letting the gateway reject the room later.
 */
export function handleFromProfile(profile: string): string {
  const cleaned = profile
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._:-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "");
  return cleaned || "agent";
}

/** Make each handle unique the way a person would: append 2, 3, … */
export function uniqueHandles(members: DraftMember[]): DraftMember[] {
  const seen = new Map<string, number>();
  return members.map((member) => {
    const base = member.handle || handleFromProfile(member.profile);
    const key = base.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? { ...member, handle: base } : { ...member, handle: `${base}${count + 1}` };
  });
}

/**
 * Everything wrong with a draft roster, in Vietnamese. Empty means sendable.
 */
export function rosterProblemsVi(members: DraftMember[]): string[] {
  const problems: string[] = [];

  if (members.length < MIN_ROOM_MEMBERS) {
    problems.push(
      `Cần ít nhất ${MIN_ROOM_MEMBERS} thành viên — một mình thì không có gì để thảo luận.`,
    );
  }
  if (members.length > MAX_ROOM_MEMBERS) {
    problems.push(`Tối đa ${MAX_ROOM_MEMBERS} thành viên một phòng.`);
  }

  const handles = new Set<string>();
  const profiles = new Set<string>();
  for (const member of members) {
    const handle = member.handle.trim();
    if (!IDENTIFIER_RE.test(handle)) {
      problems.push(
        `Handle "${handle || "(trống)"}" không hợp lệ — chỉ dùng chữ, số và . _ : - và phải bắt đầu bằng chữ hoặc số.`,
      );
      continue;
    }
    if (RESERVED_HANDLES.has(handle.toLowerCase())) {
      problems.push(`Handle "${handle}" bị Hermes giữ riêng để gọi cả phòng.`);
      continue;
    }
    if (handles.has(handle.toLowerCase())) {
      problems.push(`Handle "${handle}" bị trùng.`);
    }
    handles.add(handle.toLowerCase());

    const profile = member.profile.trim();
    if (!profile) {
      problems.push("Có thành viên chưa chọn profile.");
      continue;
    }
    if (profiles.has(profile)) {
      problems.push(`Profile "${profile}" đã được dùng cho một thành viên khác.`);
    }
    profiles.add(profile);
  }

  return problems;
}

/**
 * The `members` list exactly as `groups.create` wants it.
 *
 * `target` is left off on purpose: omitting it means "local", and the gateway
 * fills in `{kind: "local", profile}` itself after checking the profile really
 * exists here. Sending our own guess would only be a second place to be wrong.
 */
export function buildRosterPayload(
  members: DraftMember[],
): Array<{ member_id: string; profile: string; handle: string }> {
  return members.map((member) => ({
    handle: member.handle.trim(),
    member_id: member.profile.trim(),
    profile: member.profile.trim(),
  }));
}

/** A room id the gateway will accept, unique enough for a person's use. */
export function newRoomId(): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "");
  const salt = Math.random().toString(36).slice(2, 8);
  return `room-${stamp}-${salt}`;
}

/** An idempotency key for one `groups.send`. */
export function newEventId(): string {
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Things that need a person ───────────────────────────────────────────── */

export interface RoomPendingAction {
  kind: "approval" | "retry";
  taskId: string;
  memberId: string;
  requestId: string;
  /** What the member is asking permission to do, when the gateway said. */
  what: string;
}

/**
 * Read `driver_status.pending_actions`.
 *
 * Two kinds, and they are answered by different calls: `approval` →
 * `groups.approve` (only "once" or "deny" are accepted), `retry` →
 * `groups.retry`. A deferred task never resolves itself; it waits here.
 */
export function parsePendingActions(raw: unknown): RoomPendingAction[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomPendingAction[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const kind = text(record.kind);
    if (kind !== "approval" && kind !== "retry") continue;
    const approval = asRecord(record.approval);
    out.push({
      kind,
      memberId: text(record.member_id),
      requestId: text(record.request_id),
      taskId: text(record.task_id),
      what:
        text(approval?.description) ||
        text(approval?.command) ||
        text(approval?.pattern_key),
    });
  }
  return out;
}

/** One line describing what the room needs from the person. */
export function pendingActionVi(action: RoomPendingAction): string {
  if (action.kind === "retry") {
    return "Một lượt bị kẹt và Hermes không tự thử lại — cần anh bấm.";
  }
  return action.what
    ? `Xin phép chạy: ${action.what}`
    : "Một thành viên đang xin phép chạy một lệnh.";
}
