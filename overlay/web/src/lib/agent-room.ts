/**
 * "Phòng họp Agents" — live state for Hermes's delegated sub-agents.
 *
 * When Hermes delegates, it builds real child `AIAgent`s on worker threads and
 * relays their lifecycle to the parent session as `subagent.*` gateway events.
 * The Dashboard already receives every one of those frames (they ride the same
 * `/api/events` channel and `session.events.since` replay the chat text uses)
 * and, until now, dropped them all on the floor: the chat showed a spinner
 * while three agents worked, and nothing said so.
 *
 * This module is the pure reducer over those frames. The socket, the RPCs and
 * the rendering live elsewhere.
 *
 * ── What the runtime actually provides ──────────────────────────────────
 *
 * Events (tui_gateway/server.py:8100, from tools/delegate_tool.py's `_relay`):
 *   subagent.spawn_requested · start · thinking · tool · progress · complete
 * Every one carries `_identity_kwargs()`: task_index, task_count, goal,
 * subagent_id, parent_id, depth, model, toolsets, child_session_id, tool_count.
 * `subagent.complete` adds status, summary, duration_seconds, input_tokens,
 * output_tokens, reasoning_tokens, api_calls, files_read, files_written.
 *
 * `subagent.text` — the child's own reply tokens — is deliberately NOT relayed
 * to the parent session, so a child's answer body is not available here. Its
 * `summary` on completion is.
 *
 * Snapshot (`delegation.status` RPC → `list_active_subagents()`):
 *   {subagent_id, parent_id, depth, goal, delegation_id, model, started_at,
 *    status, tool_count, last_tool?} + {paused, max_spawn_depth,
 *    max_concurrent_children}
 * This is how a reloaded page recovers agents that started before it opened.
 *
 * ── What the runtime does NOT provide, and is therefore not invented here ──
 *
 * 1. **Sub-agents never talk to each other.** They are strictly isolated:
 *    separate conversation, separate toolset, separate SessionDB, and they
 *    report only to the parent that spawned them (`delegate_task` is stripped
 *    from a child's toolset by default, and no shared bus exists). So there is
 *    no agent-to-agent dialogue to show, and this module does not manufacture
 *    one. What it builds instead is a real, time-ordered stream of what each
 *    agent is doing — which is the honest version of the same view.
 * 2. **No progress percentage exists.** Nothing in the runtime estimates how
 *    far along a child is. `tool_count` (tool calls so far) and elapsed time
 *    are the only real progress signals, so those are what the UI gets; a
 *    percentage would be a number with nothing behind it.
 * 3. **No per-agent name or role.** A child has an id (`sa-0-dc0100f4`) and a
 *    goal. `role` exists in the runtime but is a capability flag
 *    ("leaf"/"orchestrator"), not a job title. So agents are labelled by their
 *    goal, not by an invented persona.
 * 4. **Live token counts are not exposed.** The gateway strips the live agent
 *    object out of `list_active_subagents()`, and the token rollup only rides
 *    on `subagent.complete`. Tokens therefore appear when an agent finishes,
 *    and are absent — not zero — before that.
 * 5. **There is no "waiting for another agent" state**, because there are no
 *    inter-agent dependencies to wait on.
 */

/**
 * Lifecycle of one delegated child, as the runtime actually reports it.
 *
 * `queued` is real, not decorative: `subagent.spawn_requested` fires before the
 * child runs precisely because it may sit waiting for a concurrency slot
 * ("the child may sit in a queue for seconds if max_concurrent_children is
 * saturated" — delegate_tool.py:2186).
 */
export type AgentState =
  | "queued"
  | "working"
  | "completed"
  | "failed"
  | "interrupted"
  | "timeout";

export interface AgentActivity {
  /** Stable de-duplication key: the gateway's per-session event seq. */
  seq: number;
  kind: "spawn" | "start" | "thinking" | "tool" | "progress" | "complete";
  /** Which agent this belongs to. */
  agentId: string;
  /** Tool name, for `tool` entries. */
  tool: string;
  /** Preview text the runtime attached, when it did. */
  text: string;
  /** Terminal status, on a `complete` entry. */
  status: string;
  /** Milliseconds since the epoch, stamped on receipt. */
  at: number;
}

export interface AgentTokens {
  input: number;
  output: number;
  reasoning: number;
  apiCalls: number;
}

export interface RoomAgent {
  /** `subagent_id` when the runtime sent one, else a task-index fallback. */
  id: string;
  subagentId: string | null;
  parentId: string | null;
  depth: number;
  taskIndex: number;
  taskCount: number;
  goal: string;
  model: string;
  toolsets: string[];
  /** The child's own gateway session, when it has one — its full transcript. */
  childSessionId: string | null;
  state: AgentState;
  /** Tool calls so far. The only real progress signal the runtime has. */
  toolCount: number;
  lastTool: string;
  /** Most recent thinking/progress preview. */
  lastText: string;
  /** Epoch ms. From the snapshot's `started_at`, else first-event receipt. */
  startedAt: number | null;
  finishedAt: number | null;
  /** Seconds, as reported on completion — authoritative over the clock. */
  durationSeconds: number | null;
  summary: string;
  /** Only ever set from `subagent.complete`; null means "not reported". */
  tokens: AgentTokens | null;
  filesRead: string[];
  filesWritten: string[];
}

export interface AgentRoom {
  agents: RoomAgent[];
  activity: AgentActivity[];
  /** `delegation.pause` state, from the snapshot. */
  paused: boolean;
  /** Runtime limits, when the snapshot reported them. */
  maxDepth: number | null;
  maxConcurrent: number | null;
}

export const EMPTY_AGENT_ROOM: AgentRoom = {
  activity: [],
  agents: [],
  maxConcurrent: null,
  maxDepth: null,
  paused: false,
};

/** How many activity entries to keep. Long runs would otherwise grow forever. */
export const ACTIVITY_LIMIT = 400;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Is this a `subagent.*` frame this module handles? */
export function isAgentEvent(type: string): boolean {
  return (
    type === "subagent.spawn_requested" ||
    type === "subagent.start" ||
    type === "subagent.thinking" ||
    type === "subagent.tool" ||
    type === "subagent.progress" ||
    type === "subagent.complete"
  );
}

const KIND_BY_TYPE: Record<string, AgentActivity["kind"]> = {
  "subagent.complete": "complete",
  "subagent.progress": "progress",
  "subagent.spawn_requested": "spawn",
  "subagent.start": "start",
  "subagent.thinking": "thinking",
  "subagent.tool": "tool",
};

/**
 * Identify the agent a frame belongs to.
 *
 * `subagent_id` is generated before the first event is relayed, so in practice
 * every frame carries it. The task-index fallback exists because the field is
 * declared optional in the emitter ("older emitters that omit them fall back to
 * flat rendering client-side"), and a frame with no key at all would otherwise
 * silently create a new phantom agent on every event.
 */
export function agentKey(payload: Record<string, unknown>): string {
  const id = str(payload.subagent_id).trim();
  if (id) return id;
  const index = int(payload.task_index);
  return `task-${index ?? 0}`;
}

/** Terminal status → lifecycle state. Anything unfamiliar counts as failure. */
export function stateFromStatus(status: string): AgentState {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "completed";
  if (value === "interrupted") return "interrupted";
  if (value === "timeout") return "timeout";
  // `failed` and `error` are the runtime's two failure words
  // (SUBAGENT_FAILURE_STATUSES); an unknown terminal status is still terminal,
  // and calling it "done" would hide a problem.
  return "failed";
}

export function isFinished(state: AgentState): boolean {
  return state !== "queued" && state !== "working";
}

function blankAgent(id: string): RoomAgent {
  return {
    childSessionId: null,
    depth: 0,
    durationSeconds: null,
    filesRead: [],
    filesWritten: [],
    finishedAt: null,
    goal: "",
    id,
    lastTool: "",
    lastText: "",
    model: "",
    parentId: null,
    startedAt: null,
    state: "queued",
    subagentId: null,
    summary: "",
    taskCount: 1,
    taskIndex: 0,
    tokens: null,
    toolCount: 0,
    toolsets: [],
  };
}

/**
 * Merge the identity fields every relayed event carries.
 *
 * Fields are only overwritten when the frame actually carries them: the
 * emitter omits optional keys rather than sending nulls, so a later, sparser
 * event must not erase a model or a child session id an earlier one supplied.
 */
function withIdentity(
  agent: RoomAgent,
  payload: Record<string, unknown>,
): RoomAgent {
  const next = { ...agent };
  const subagentId = str(payload.subagent_id).trim();
  if (subagentId) next.subagentId = subagentId;
  const parentId = str(payload.parent_id).trim();
  if (parentId) next.parentId = parentId;
  const childSessionId = str(payload.child_session_id).trim();
  if (childSessionId) next.childSessionId = childSessionId;
  const goal = str(payload.goal).trim();
  if (goal) next.goal = goal;
  const model = str(payload.model).trim();
  if (model) next.model = model;

  const depth = int(payload.depth);
  if (depth !== null) next.depth = depth;
  const taskIndex = int(payload.task_index);
  if (taskIndex !== null) next.taskIndex = taskIndex;
  const taskCount = int(payload.task_count);
  if (taskCount !== null) next.taskCount = taskCount;

  // tool_count is a running counter; a late-arriving lower value would be a
  // reordered frame, so it only ever moves forward.
  const toolCount = int(payload.tool_count);
  if (toolCount !== null) next.toolCount = Math.max(next.toolCount, toolCount);

  const toolsets = strList(payload.toolsets);
  if (toolsets.length) next.toolsets = toolsets;

  return next;
}

export interface AgentFrame {
  type: string;
  payload?: unknown;
  seq: number | null;
}

/**
 * Fold one `subagent.*` frame into the room.
 *
 * `now` is injected so replayed frames can be stamped by the caller and tests
 * stay deterministic. Returns the same object when nothing changed, so React
 * can skip a render.
 */
export function reduceAgentRoom(
  room: AgentRoom,
  frame: AgentFrame,
  now: number = Date.now(),
): AgentRoom {
  const kind = KIND_BY_TYPE[frame.type];
  if (!kind) return room;
  const payload = asRecord(frame.payload);
  if (!payload) return room;

  const id = agentKey(payload);
  const existing = room.agents.find((entry) => entry.id === id);
  const agent = withIdentity(existing ?? blankAgent(id), payload);

  switch (kind) {
    case "spawn":
      // Announced but not necessarily running: it may be waiting for a
      // concurrency slot. Only `start` means work began.
      if (!existing) agent.state = "queued";
      break;

    case "start":
      if (!isFinished(agent.state)) {
        agent.state = "working";
        agent.startedAt = agent.startedAt ?? now;
      }
      break;

    case "thinking":
    case "progress": {
      const text = str(payload.text).trim();
      if (text) agent.lastText = text;
      if (!isFinished(agent.state)) {
        agent.state = "working";
        agent.startedAt = agent.startedAt ?? now;
      }
      break;
    }

    case "tool": {
      const tool = str(payload.tool_name).trim();
      if (tool) agent.lastTool = tool;
      const preview = str(payload.tool_preview) || str(payload.text);
      if (preview.trim()) agent.lastText = preview.trim();
      if (!isFinished(agent.state)) {
        agent.state = "working";
        agent.startedAt = agent.startedAt ?? now;
      }
      break;
    }

    case "complete": {
      agent.state = stateFromStatus(str(payload.status));
      agent.finishedAt = now;
      const summary = str(payload.summary).trim();
      if (summary) agent.summary = summary;
      const duration = payload.duration_seconds;
      if (typeof duration === "number" && Number.isFinite(duration)) {
        agent.durationSeconds = duration;
      }
      // The token rollup only ever arrives here. Absent stays null, so the UI
      // can tell "not reported" from "zero".
      const input = int(payload.input_tokens);
      const output = int(payload.output_tokens);
      const reasoning = int(payload.reasoning_tokens);
      const apiCalls = int(payload.api_calls);
      if (
        input !== null ||
        output !== null ||
        reasoning !== null ||
        apiCalls !== null
      ) {
        agent.tokens = {
          apiCalls: apiCalls ?? 0,
          input: input ?? 0,
          output: output ?? 0,
          reasoning: reasoning ?? 0,
        };
      }
      const filesRead = strList(payload.files_read);
      if (filesRead.length) agent.filesRead = filesRead;
      const filesWritten = strList(payload.files_written);
      if (filesWritten.length) agent.filesWritten = filesWritten;
      break;
    }
  }

  // Nothing about the agent moved and no entry is worth logging — but the
  // identity merge may still have filled a field, so compare rather than
  // assume.
  const agents = existing
    ? room.agents.map((entry) => (entry.id === id ? agent : entry))
    : [...room.agents, agent];

  const entry: AgentActivity = {
    agentId: id,
    at: now,
    kind,
    seq: frame.seq ?? -1,
    status: str(payload.status),
    text:
      kind === "tool"
        ? str(payload.tool_preview) || str(payload.text)
        : kind === "complete"
          ? str(payload.summary) || str(payload.text)
          : str(payload.text),
    tool: str(payload.tool_name),
  };

  const activity = [...room.activity, entry];
  return {
    ...room,
    activity:
      activity.length > ACTIVITY_LIMIT
        ? activity.slice(activity.length - ACTIVITY_LIMIT)
        : activity,
    agents,
  };
}

/**
 * Fold the `delegation.status` snapshot in.
 *
 * This is the reload/reconnect path: the snapshot lists agents that are alive
 * *right now*, including ones spawned before this page existed. It is merged,
 * never used as a replacement — the snapshot has no history, and an agent that
 * finished a moment ago is simply absent from it, which must not delete the
 * record of it having run.
 *
 * The snapshot's own `status` field is not trusted for lifecycle: the runtime
 * writes "running" at registration and removes the entry on completion rather
 * than updating it, so it is "running" for everything it ever returns.
 */
export function applyDelegationStatus(
  room: AgentRoom,
  response: unknown,
): AgentRoom {
  const record = asRecord(response);
  if (!record) return room;

  const rows = Array.isArray(record.active) ? record.active : [];
  const agents = [...room.agents];

  for (const row of rows) {
    const payload = asRecord(row);
    if (!payload) continue;
    const id = agentKey(payload);
    const index = agents.findIndex((entry) => entry.id === id);
    const agent = withIdentity(agents[index] ?? blankAgent(id), payload);

    // Present in the snapshot means alive now, so an entry this page had
    // already marked finished is not resurrected — but one it has never seen
    // is working.
    if (!isFinished(agent.state)) agent.state = "working";

    // `started_at` is epoch SECONDS from the Python side.
    const startedAt = payload.started_at;
    if (typeof startedAt === "number" && Number.isFinite(startedAt)) {
      agent.startedAt = Math.round(startedAt * 1000);
    }
    const lastTool = str(payload.last_tool).trim();
    if (lastTool) agent.lastTool = lastTool;

    if (index >= 0) agents[index] = agent;
    else agents.push(agent);
  }

  return {
    ...room,
    agents,
    maxConcurrent: int(record.max_concurrent_children),
    maxDepth: int(record.max_spawn_depth),
    paused: record.paused === true,
  };
}

/**
 * Agents that are still running.
 *
 * Note there is deliberately no "the feed dropped, mark them all stale" helper.
 * A dropped socket says nothing about the agents — they keep running inside
 * Hermes regardless — so the disconnected state belongs on the panel as a
 * banner, not on each agent as a fabricated terminal status. The next
 * `delegation.status` after reconnect restores the truth.
 */
export function liveAgents(room: AgentRoom): RoomAgent[] {
  return room.agents.filter((agent) => !isFinished(agent.state));
}

/** Is there anything at all to show? */
export function hasAgents(room: AgentRoom): boolean {
  return room.agents.length > 0;
}

/**
 * Order agents for display: still-running first, then by spawn order.
 *
 * Sorting by task index rather than by arrival keeps a batch in the order the
 * user's own request listed its tasks.
 */
export function sortedAgents(room: AgentRoom): RoomAgent[] {
  return [...room.agents].sort((a, b) => {
    const aDone = isFinished(a.state) ? 1 : 0;
    const bDone = isFinished(b.state) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.taskIndex - b.taskIndex;
  });
}

/** Vietnamese label for each lifecycle state. */
export const AGENT_STATE_VI: Record<AgentState, string> = {
  completed: "Hoàn thành",
  failed: "Thất bại",
  interrupted: "Đã dừng",
  queued: "Đang chờ tới lượt",
  timeout: "Quá giờ",
  working: "Đang làm việc",
};

/**
 * A short label for an agent.
 *
 * The runtime gives no name — only a goal — so the goal is the name, trimmed
 * to something a card can hold. Inventing job titles ("Kiến trúc sư") would
 * mean showing the user a role Hermes never assigned.
 */
export function agentLabelVi(agent: RoomAgent): string {
  const goal = agent.goal.trim();
  if (!goal) {
    return agent.taskCount > 1 ? `Tác vụ ${agent.taskIndex + 1}` : "Agent phụ";
  }
  const firstLine = goal.split("\n")[0].trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine;
}

/** What the agent is doing right now, in one line. */
export function agentDoingVi(agent: RoomAgent): string {
  if (agent.state === "queued") return "Đang đợi chỗ trống để chạy";
  if (isFinished(agent.state)) {
    return agent.summary.split("\n")[0].trim() || AGENT_STATE_VI[agent.state];
  }
  if (agent.lastTool) return `Đang dùng ${agent.lastTool}`;
  if (agent.lastText) {
    const line = agent.lastText.split("\n")[0].trim();
    return line.length > 90 ? `${line.slice(0, 90)}…` : line;
  }
  return "Đang xử lý";
}

/** `mm:ss` for an elapsed span, or a blank when there is no clock to show. */
export function elapsedVi(agent: RoomAgent, now: number = Date.now()): string {
  if (agent.durationSeconds !== null) {
    return formatClock(agent.durationSeconds);
  }
  if (agent.startedAt === null) return "";
  const end = agent.finishedAt ?? now;
  return formatClock(Math.max(0, (end - agent.startedAt) / 1000));
}

function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** One line summarising the room, for a collapsed header or a badge. */
export function roomSummaryVi(room: AgentRoom): string {
  const live = liveAgents(room).length;
  const done = room.agents.length - live;
  if (!room.agents.length) return "Chưa có agent phụ nào";
  if (!live) return `${done} agent phụ đã xong`;
  if (!done) return `${live} agent phụ đang chạy`;
  return `${live} đang chạy · ${done} đã xong`;
}

/**
 * The activity stream for display, newest last.
 *
 * Deliberately not called a conversation: these are the agents' own working
 * steps relayed to Hermes, not messages between them. Hermes's sub-agents are
 * isolated from one another by design.
 */
export function roomTimeline(
  room: AgentRoom,
  agentId?: string | null,
): AgentActivity[] {
  const entries = agentId
    ? room.activity.filter((entry) => entry.agentId === agentId)
    : room.activity;
  return entries;
}

/** Vietnamese verb for one activity entry. */
export const ACTIVITY_KIND_VI: Record<AgentActivity["kind"], string> = {
  complete: "kết thúc",
  progress: "báo tiến độ",
  spawn: "được giao việc",
  start: "bắt đầu chạy",
  thinking: "đang suy nghĩ",
  tool: "gọi công cụ",
};

/**
 * A plain-text minutes of the meeting, for the copy and export buttons.
 *
 * Built from the same state the panel renders, so what is exported is exactly
 * what was on screen.
 */
export function roomTranscriptText(
  room: AgentRoom,
  now: number = Date.now(),
): string {
  const lines: string[] = ["# Biên bản phòng họp Agents", ""];
  lines.push(`Thời điểm xuất: ${new Date(now).toLocaleString()}`);
  lines.push(roomSummaryVi(room));
  lines.push("");

  for (const agent of sortedAgents(room)) {
    lines.push(`## ${agentLabelVi(agent)}`);
    lines.push(`- Trạng thái: ${AGENT_STATE_VI[agent.state]}`);
    if (agent.model) lines.push(`- Model: ${agent.model}`);
    const elapsed = elapsedVi(agent, now);
    if (elapsed) lines.push(`- Thời gian: ${elapsed}`);
    lines.push(`- Số lần gọi công cụ: ${agent.toolCount}`);
    if (agent.tokens) {
      lines.push(
        `- Token: vào ${agent.tokens.input} · ra ${agent.tokens.output} · ${agent.tokens.apiCalls} lượt gọi API`,
      );
    }
    if (agent.summary) lines.push(`- Kết quả: ${agent.summary}`);
    if (agent.filesWritten.length) {
      lines.push(`- Tệp đã ghi: ${agent.filesWritten.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Diễn biến");
  for (const entry of room.activity) {
    const agent = room.agents.find((item) => item.id === entry.agentId);
    const who = agent ? agentLabelVi(agent) : entry.agentId;
    const when = new Date(entry.at).toLocaleTimeString();
    const what = ACTIVITY_KIND_VI[entry.kind];
    const detail = entry.tool ? `${entry.tool} — ${entry.text}` : entry.text;
    lines.push(`- ${when} · ${who} · ${what}${detail ? `: ${detail}` : ""}`);
  }

  return lines.join("\n");
}
