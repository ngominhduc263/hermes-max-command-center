import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Crown,
  Download,
  Minimize2,
  Maximize2,
  CircleStop,
  Users,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ACTIVITY_KIND_VI,
  AGENT_STATE_VI,
  agentDoingVi,
  agentLabelVi,
  elapsedVi,
  isFinished,
  liveAgents,
  roomSummaryVi,
  roomTimeline,
  roomTranscriptText,
  sortedAgents,
  type AgentRoom as AgentRoomState,
  type RoomAgent,
} from "@/lib/agent-room";

type RoomView = "live" | "summary" | "log" | "child";

const VIEW_LABEL: Record<RoomView, string> = {
  child: "Hội thoại riêng",
  live: "Diễn biến trực tiếp",
  log: "Nhật ký quyết định",
  summary: "Tóm tắt",
};

interface AgentRoomProps {
  room: AgentRoomState;
  /**
   * Stops one agent — `subagent.interrupt`. Absent when the gateway is not
   * reachable, which hides the button rather than showing a dead one.
   */
  onStopAgent?: (agent: RoomAgent) => Promise<boolean>;
  /** Toggles `delegation.pause` — stops NEW agents spawning, not running ones. */
  onPauseSpawn?: (paused: boolean) => Promise<boolean>;
  /** True while the live feed is down; the agents keep running regardless. */
  disconnected?: boolean;
  /**
   * Load a sub-agent's own transcript by its `child_session_id`.
   *
   * Every relayed `subagent.*` event carries that id, and a child writes its
   * full conversation to its own session — so this is real, complete content,
   * not a reconstruction. Reading it here is also the safe way to see it: the
   * chat itself must never navigate onto a child session, which is exactly the
   * accident that used to make the main conversation disappear.
   */
  onLoadChildTranscript?: (sessionId: string) => Promise<ChildMessage[]>;
}

export interface ChildMessage {
  role: string;
  content: string | null;
}

/**
 * "Phòng họp Agents" — what Hermes's delegated sub-agents are doing.
 *
 * Hermes builds real child agents on worker threads and relays their lifecycle
 * to the parent session as `subagent.*` events. The Dashboard received every
 * one of those frames already and showed none of them: three agents could be
 * working while the chat displayed a single spinner.
 *
 * ── Honesty notes, because this panel is easy to fake ───────────────────
 *
 * **These agents do not talk to each other.** Hermes isolates them completely —
 * separate conversation, separate toolset, separate session store — and each
 * reports only to the parent that spawned it. So this is not a chat room, and
 * the tab is "Diễn biến trực tiếp", not a conversation: what it shows is each
 * agent's real working steps, interleaved by time. Rendering invented
 * agent-to-agent dialogue would look better and mean nothing.
 *
 * **No progress percentage is shown, because none exists.** Nothing in the
 * runtime estimates completion. The real signals are the tool-call count and
 * the clock, so those are what a card shows; the bar is a working/finished
 * indicator, never a fabricated fraction.
 *
 * **No invented job titles.** A child has a goal and an id, not a role, so the
 * goal is the label.
 *
 * **Only real controls.** Stopping one agent (`subagent.interrupt`) and pausing
 * new spawns (`delegation.pause`) exist and work. Pausing a single running
 * agent does not exist in Hermes, so there is no pause button on a card.
 */
export function AgentRoom({
  room,
  onStopAgent,
  onPauseSpawn,
  disconnected,
  onLoadChildTranscript,
}: AgentRoomProps) {
  const [view, setView] = useState<RoomView>("live");
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [busyPause, setBusyPause] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [child, setChild] = useState<ChildMessage[] | null>(null);
  const [childBusy, setChildBusy] = useState(false);
  const [childError, setChildError] = useState("");

  const streamRef = useRef<HTMLDivElement | null>(null);

  const agents = useMemo(() => sortedAgents(room), [room]);
  const running = liveAgents(room).length;

  // One clock for the whole panel rather than a timer per card. Only ticks
  // while something is actually running, so a finished room is inert.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // A selected agent that has since been forgotten must not leave the detail
  // view pinned to nothing.
  const selectedAgent = agents.find((agent) => agent.id === selected) ?? null;
  const timeline = useMemo(
    () => roomTimeline(room, selectedAgent?.id ?? null),
    [room, selectedAgent],
  );

  useEffect(() => {
    if (!follow || view !== "live") return;
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [follow, timeline.length, view]);

  // Fetch a child's own transcript only when the tab is actually opened, and
  // re-fetch when the selected agent changes. A child session can be long, so
  // this never rides the live poll.
  const childSessionId = selectedAgent?.childSessionId ?? null;
  useEffect(() => {
    if (view !== "child" || !childSessionId || !onLoadChildTranscript) return;
    let alive = true;
    // setState lives in a callback, never in the effect body — React 19 flags
    // a synchronous one as a cascading render.
    Promise.resolve()
      .then(() => {
        setChildBusy(true);
        return onLoadChildTranscript(childSessionId);
      })
      .then((messages) => {
        if (!alive) return;
        setChild(messages);
        setChildError("");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setChild(null);
        setChildError(
          reason instanceof Error ? reason.message : "không đọc được phiên con",
        );
      })
      .finally(() => {
        if (alive) setChildBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [childSessionId, onLoadChildTranscript, view]);

  const copyTranscript = useCallback(() => {
    const text = roomTranscriptText(room);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  }, [room]);

  const exportTranscript = useCallback(() => {
    const blob = new Blob([roomTranscriptText(room)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `bien-ban-agents-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.md`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [room]);

  return (
    <section
      className={cn("hermes-agent-room", fullscreen && "is-fullscreen")}
      aria-label="Phòng họp Agents"
    >
      <header className="hermes-agent-room-head">
        <button
          type="button"
          className="hermes-agent-room-title"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <Crown className="h-4 w-4" />
          <strong>Phòng họp Agents</strong>
          <span>{roomSummaryVi(room)}</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5", expanded && "hermes-agent-room-caret")}
          />
        </button>

        <div className="hermes-agent-room-actions">
          {disconnected ? (
            <span className="hermes-agent-room-offline">
              <WifiOff className="h-3.5 w-3.5" />
              Mất kết nối — agent vẫn chạy trong Hermes
            </span>
          ) : null}

          <label className="hermes-agent-room-follow">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.currentTarget.checked)}
            />
            Theo dõi tự động
          </label>

          {onPauseSpawn ? (
            <button
              type="button"
              disabled={busyPause}
              title="Chặn Hermes giao thêm việc cho agent mới. Agent đang chạy không bị ảnh hưởng."
              onClick={() => {
                setBusyPause(true);
                void onPauseSpawn(!room.paused).finally(() => setBusyPause(false));
              }}
            >
              {room.paused ? "Cho giao việc mới" : "Ngưng giao việc mới"}
            </button>
          ) : null}

          <button type="button" onClick={copyTranscript}>
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Đã chép" : "Sao chép"}
          </button>
          <button type="button" onClick={exportTranscript}>
            <Download className="h-3.5 w-3.5" />
            Xuất biên bản
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((open) => !open)}
            title={fullscreen ? "Thu nhỏ" : "Mở toàn màn hình"}
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </header>

      {expanded ? (
        <div className="hermes-agent-room-body">
          <div className="hermes-agent-room-tree">
            <div className="hermes-agent-room-parent">
              <Crown className="h-3.5 w-3.5" />
              <div>
                <strong>Hermes chính</strong>
                <span>
                  Điều phối {room.agents.length} agent phụ
                  {room.maxConcurrent !== null
                    ? ` · tối đa ${room.maxConcurrent} cùng lúc`
                    : ""}
                </span>
              </div>
            </div>

            <ul className="hermes-agent-room-cards">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    className={cn(
                      "hermes-agent-card",
                      `is-${agent.state}`,
                      agent.id === selected && "is-active",
                    )}
                    onClick={() =>
                      setSelected((current) =>
                        current === agent.id ? null : agent.id,
                      )
                    }
                  >
                    <span className="hermes-agent-card-head">
                      <Users className="h-3.5 w-3.5" />
                      <strong>{agentLabelVi(agent)}</strong>
                      <em>{AGENT_STATE_VI[agent.state]}</em>
                    </span>

                    <span className="hermes-agent-card-doing">
                      {agentDoingVi(agent)}
                    </span>

                    {/* Working/finished, never a made-up percentage: nothing in
                        Hermes estimates how far along a child is. */}
                    <span
                      className={cn(
                        "hermes-agent-card-bar",
                        isFinished(agent.state) ? "is-done" : "is-running",
                      )}
                      aria-hidden="true"
                    >
                      <span />
                    </span>

                    <span className="hermes-agent-card-facts">
                      {agent.model ? <code>{agent.model}</code> : null}
                      {elapsedVi(agent, now) ? (
                        <span>{elapsedVi(agent, now)}</span>
                      ) : null}
                      <span>{agent.toolCount} lần gọi công cụ</span>
                      {agent.tokens ? (
                        <span>
                          {agent.tokens.input + agent.tokens.output} token
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {onStopAgent && !isFinished(agent.state) && agent.subagentId ? (
                    <button
                      type="button"
                      className="hermes-agent-card-stop"
                      disabled={stopping === agent.id}
                      title="Dừng agent này"
                      onClick={() => {
                        setStopping(agent.id);
                        void onStopAgent(agent).finally(() => setStopping(null));
                      }}
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="hermes-agent-room-panel">
            <div className="hermes-agent-room-tabs" role="tablist">
              {(
                [
                  "live",
                  "summary",
                  "log",
                  // Only when a child session exists to read and a loader
                  // was given — a tab that can never fill is worse than no
                  // tab.
                  ...(childSessionId && onLoadChildTranscript
                    ? (["child"] as RoomView[])
                    : []),
                ] as RoomView[]
              ).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  className={cn(view === value && "is-active")}
                  onClick={() => setView(value)}
                >
                  {VIEW_LABEL[value]}
                </button>
              ))}
              {selectedAgent ? (
                <span className="hermes-agent-room-filter">
                  Chỉ xem: {agentLabelVi(selectedAgent)}
                  <button type="button" onClick={() => setSelected(null)}>
                    bỏ lọc
                  </button>
                </span>
              ) : null}
            </div>

            {view === "live" ? (
              <div className="hermes-agent-room-stream" ref={streamRef}>
                {!timeline.length ? (
                  <p className="hermes-agent-room-empty">
                    Chưa có diễn biến nào được ghi lại.
                  </p>
                ) : (
                  <ol>
                    {timeline.map((entry, index) => {
                      const agent = room.agents.find(
                        (item) => item.id === entry.agentId,
                      );
                      return (
                        <li
                          key={`${entry.seq}-${entry.agentId}-${index}`}
                          className={`is-${entry.kind}`}
                        >
                          <span className="hermes-agent-room-time">
                            {new Date(entry.at).toLocaleTimeString()}
                          </span>
                          <span className="hermes-agent-room-who">
                            {agent ? agentLabelVi(agent) : entry.agentId}
                          </span>
                          <span className="hermes-agent-room-what">
                            <em>{ACTIVITY_KIND_VI[entry.kind]}</em>
                            {entry.tool ? <code>{entry.tool}</code> : null}
                            {entry.text ? <span>{entry.text}</span> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {running ? (
                  <p className="hermes-agent-room-typing">
                    <span />
                    <span />
                    <span />
                    {running === 1
                      ? "Một agent đang làm việc…"
                      : `${running} agent đang làm việc…`}
                  </p>
                ) : null}
              </div>
            ) : null}

            {view === "summary" ? (
              <div className="hermes-agent-room-summary">
                {agents.map((agent) => (
                  <article key={agent.id}>
                    <h4>
                      {agentLabelVi(agent)}
                      <em>{AGENT_STATE_VI[agent.state]}</em>
                    </h4>
                    {agent.summary ? <p>{agent.summary}</p> : null}
                    <dl>
                      {agent.model ? (
                        <div>
                          <dt>Model</dt>
                          <dd>
                            <code>{agent.model}</code>
                          </dd>
                        </div>
                      ) : null}
                      {elapsedVi(agent, now) ? (
                        <div>
                          <dt>Thời gian</dt>
                          <dd>{elapsedVi(agent, now)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Gọi công cụ</dt>
                        <dd>{agent.toolCount}</dd>
                      </div>
                      {agent.tokens ? (
                        <div>
                          <dt>Token</dt>
                          <dd>
                            vào {agent.tokens.input} · ra {agent.tokens.output}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {agent.filesWritten.length ? (
                      <p className="hermes-agent-room-files">
                        Đã ghi: {agent.filesWritten.join(", ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}

            {view === "log" ? (
              <div className="hermes-agent-room-log">
                <ol>
                  {timeline
                    .filter(
                      (entry) =>
                        entry.kind === "spawn" ||
                        entry.kind === "start" ||
                        entry.kind === "complete",
                    )
                    .map((entry, index) => {
                      const agent = room.agents.find(
                        (item) => item.id === entry.agentId,
                      );
                      return (
                        <li key={`${entry.seq}-${index}`}>
                          <span>{new Date(entry.at).toLocaleTimeString()}</span>
                          <strong>
                            {agent ? agentLabelVi(agent) : entry.agentId}
                          </strong>
                          <em>{ACTIVITY_KIND_VI[entry.kind]}</em>
                          {entry.status ? <code>{entry.status}</code> : null}
                          {entry.kind === "complete" && entry.text ? (
                            <span>{entry.text}</span>
                          ) : null}
                        </li>
                      );
                    })}
                </ol>
                {!timeline.some(
                  (entry) => entry.kind === "spawn" || entry.kind === "start",
                ) ? (
                  <p className="hermes-agent-room-empty">
                    Chưa có mốc nào được ghi.
                  </p>
                ) : null}
              </div>
            ) : null}

            {view === "child" ? (
              <div className="hermes-agent-room-child">
                {childBusy ? (
                  <p className="hermes-agent-room-empty">Đang mở phiên con…</p>
                ) : childError ? (
                  <p className="hermes-agent-room-empty">
                    Không đọc được phiên riêng của agent này ({childError}).
                  </p>
                ) : !child?.length ? (
                  <p className="hermes-agent-room-empty">
                    Phiên riêng của agent này chưa có nội dung nào.
                  </p>
                ) : (
                  <ol>
                    {child.map((message, index) => (
                      <li key={index} className={`is-${message.role}`}>
                        <strong>
                          {message.role === "user"
                            ? "Việc được giao"
                            : message.role === "assistant"
                              ? "Agent phụ"
                              : message.role}
                        </strong>
                        <pre>{message.content ?? ""}</pre>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}

            <p className="hermes-agent-room-note">
              Các agent phụ của Hermes làm việc độc lập và chỉ báo cáo về Hermes
              chính — chúng không trao đổi trực tiếp với nhau. Đây là diễn biến
              thật của từng agent, xếp theo thời gian.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
