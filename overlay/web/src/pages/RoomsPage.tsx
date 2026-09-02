import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AtSign,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  Cpu,
  Crown,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";

import { api, type ProfileInfo } from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import { cn } from "@/lib/utils";
import {
  buildDiscussion,
  buildRosterPayload,
  handleFromProfile,
  MAX_DISCUSSION_MESSAGES,
  MAX_DISCUSSION_ROUNDS,
  MAX_ROOM_MEMBERS,
  MIN_ROOM_MEMBERS,
  newEventId,
  newRoomId,
  parsePendingActions,
  parseRoomCapabilities,
  parseRoomList,
  parseRoomLog,
  parseRoomState,
  pendingActionVi,
  roomTimeVi,
  rosterProblemsVi,
  uniqueHandles,
  type DiscussionTurn,
  type DraftMember,
  type Room,
  type RoomCapabilities,
  type RoomDiscussion,
  type RoomDriverStatus,
  type RoomEvent,
  type RoomPendingAction,
} from "@/lib/hermes-rooms";
import {
  avatarStyle,
  buildPeople,
  hueFor,
  initialsFor,
  personActivityVi,
  type RoomPerson,
} from "@/lib/room-people";
import {
  applyStateVi,
  buildModelUpdate,
  modelProblemVi,
  scopeWarningVi,
  type ModelChoice,
} from "@/lib/room-member-model";
import {
  modelShortLabel,
  searchModelOptions,
} from "@/lib/chat-favorite-models";

/** One page of log per read; the gateway caps this at 500. */
const LOG_LIMIT = 200;
/** While a turn is running. The driver itself re-scans every 0.25s. */
const POLL_BUSY_MS = 1200;
/** Nothing is running — the room only changes when the person sends. */
const POLL_IDLE_MS = 6000;
/** Remembered so the room list does not reopen on every visit. */
const RAIL_KEY = "hermes-max-rooms-rail";

/**
 * "Nhóm" — Hermes's hosted rooms, where several agents actually talk.
 *
 * Three columns: the room list (collapsible, because the conversation deserves
 * the width), the discussion itself, and who is in it.
 *
 * ── What drives it ──────────────────────────────────────────────────────
 *
 * `groups.create` builds a room; `groups.send` starts the discussion by waking
 * the driver the gateway already runs. Members are local profiles — no peer
 * setup, no room-link grant, nothing to configure.
 *
 * ── Why it polls ────────────────────────────────────────────────────────
 *
 * No push channel exists: not one `_emit` call anywhere in the hosted-room
 * modules, and each member runs in a hidden session whose id never reaches the
 * room log, so there is nothing to subscribe to. The cadence is ours — the
 * runtime specifies none — and follows `driver_status.working`.
 *
 * ── What this screen will not pretend ───────────────────────────────────
 *
 * A chat UI wants faces, job titles and little green online dots. Hermes stores
 * a member as `{member_id, profile, handle}` and nothing more, so: avatars are
 * generated initials, not invented photographs; the line under a name is the
 * **profile's own description** (empty when the user wrote none) rather than a
 * role Hermes never assigned; and there is no per-member online light, because
 * `driver_status` reports liveness for the room, never per member — what it
 * shows instead is which round each member last spoke in.
 *
 * The meeting-settings card lists real constants and offers no edit button:
 * the 3-round / 10-message bounds are compiled into `hosted_room_discussion.py`
 * and cannot be changed from a client.
 *
 * Authority takeover (`groups.promote` / `groups.demote`) stays unbuilt —
 * Hermes calls it "an explicit user action today; a lease/quorum driver later".
 */
export default function RoomsPage() {
  const [caps, setCaps] = useState<RoomCapabilities | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [driver, setDriver] = useState<RoomDriverStatus | null>(null);
  const [pending, setPending] = useState<RoomPendingAction[]>([]);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [roomFilter, setRoomFilter] = useState("");
  const [chatFilter, setChatFilter] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_KEY) !== "closed";
    } catch {
      return true;
    }
  });

  const gatewayRef = useRef<GatewayClient | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_KEY, railOpen ? "open" : "closed");
    } catch {
      /* private window, or storage blocked — the rail just forgets */
    }
  }, [railOpen]);

  const call = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}) => {
      let gateway = gatewayRef.current;
      if (!gateway) {
        gateway = new GatewayClient();
        gatewayRef.current = gateway;
      }
      if (gateway.connectionState !== "open") await gateway.connect();
      return gateway.request<T>(method, params);
    },
    [],
  );

  useEffect(
    () => () => {
      gatewayRef.current?.close();
      gatewayRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let capabilities: RoomCapabilities;
        try {
          capabilities = parseRoomCapabilities(
            await call<unknown>("groups.capabilities"),
          );
        } catch {
          capabilities = parseRoomCapabilities(null);
        }
        if (!alive) return;
        setCaps(capabilities);
        if (!capabilities.available) {
          setLoading(false);
          return;
        }
        const listed = parseRoomList(await call<unknown>("groups.list", {}));
        if (!alive) return;
        setRooms(listed);
        setError("");
        setLoading(false);
      } catch (reason: unknown) {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      }
    })();

    Promise.resolve()
      .then(() => api.getProfiles())
      .then((res) => {
        if (alive) setProfiles(res.profiles ?? []);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [call, tick]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const raw = await call<{
          driver_status?: { pending_actions?: unknown };
        }>("groups.state", { room_id: selected });
        if (!alive) return;
        setDriver(parseRoomState(raw).driver);
        setPending(parsePendingActions(raw?.driver_status?.pending_actions));

        const page = parseRoomLog(
          await call<unknown>("groups.log", {
            limit: LOG_LIMIT,
            room_id: selected,
            since_seq: 0,
          }),
        );
        if (!alive) return;
        setEvents(page.events);
        setError("");
      } catch (reason: unknown) {
        if (alive) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (alive) {
        timer = window.setTimeout(
          poll,
          driver?.working ? POLL_BUSY_MS : POLL_IDLE_MS,
        );
      }
    };

    void poll();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [call, selected, driver?.working]);

  const room = rooms.find((entry) => entry.roomId === selected) ?? null;
  const discussion: RoomDiscussion = useMemo(
    () => buildDiscussion(events, room?.members ?? []),
    [events, room],
  );
  const people = useMemo(
    () => buildPeople(room?.members ?? [], profiles, events),
    [events, profiles, room],
  );

  const turns = useMemo(() => {
    const needle = chatFilter.trim().toLowerCase();
    if (!needle) return discussion.turns;
    return discussion.turns.filter(
      (turn) =>
        turn.text.toLowerCase().includes(needle) ||
        turn.label.toLowerCase().includes(needle),
    );
  }, [chatFilter, discussion.turns]);

  const visibleRooms = useMemo(() => {
    const needle = roomFilter.trim().toLowerCase();
    if (!needle) return rooms;
    return rooms.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.members.some((member) =>
          member.label.toLowerCase().includes(needle),
        ),
    );
  }, [roomFilter, rooms]);

  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setComposing(true);
    try {
      await call("groups.send", {
        event_id: newEventId(),
        payload: { text, thread_id: "main" },
        room_id: selected,
      });
      setDraft("");
      setError("");
      setDriver((current) => (current ? { ...current, working: true } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setComposing(false);
    }
  }, [call, draft, selected]);

  const answer = useCallback(
    async (action: RoomPendingAction, choice: "once" | "deny") => {
      if (!selected) return;
      setBusy(action.taskId);
      try {
        if (action.kind === "retry") {
          await call("groups.retry", { room_id: selected, task_id: action.taskId });
        } else {
          await call("groups.approve", {
            choice,
            member_id: action.memberId,
            room_id: selected,
            task_id: action.taskId,
          });
        }
        setPending((current) =>
          current.filter((entry) => entry.taskId !== action.taskId),
        );
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy("");
      }
    },
    [call, selected],
  );

  const rename = useCallback(
    async (name: string) => {
      if (!selected || !name.trim()) return;
      await call("groups.rename", {
        event_id: newEventId(),
        name: name.trim(),
        room_id: selected,
      });
      setTick((value) => value + 1);
      setRenaming(false);
    },
    [call, selected],
  );

  const disband = useCallback(async () => {
    if (!selected) return;
    setBusy("disband");
    try {
      await call("groups.disband", { room_id: selected });
      setSelected(null);
      setEvents([]);
      setTick((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }, [call, selected]);

  if (loading) {
    return (
      <div className="hermes-rooms-boot">
        <Spinner /> Đang hỏi gateway…
      </div>
    );
  }

  if (caps && !caps.available) {
    return (
      <div className="hermes-rooms-boot">
        <AlertCircle className="h-4 w-4" />
        Gateway này chưa có tính năng Nhóm — cần Hermes v0.21.0 trở lên.
      </div>
    );
  }

  return (
    <div className={cn("hermes-rooms-shell", !railOpen && "is-rail-closed")}>
      <aside className="hermes-rooms-rail">
        <div className="hermes-rooms-rail-top">
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            prefix={<Plus className="h-3.5 w-3.5" />}
          >
            Tạo phòng
          </Button>
        </div>

        <label className="hermes-rooms-search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={roomFilter}
            onChange={(event) => setRoomFilter(event.currentTarget.value)}
            placeholder="Tìm phòng…"
          />
        </label>

        <p className="hermes-rooms-rail-label">Phòng của tôi</p>
        <div className="hermes-rooms-rail-list">
          {!visibleRooms.length ? (
            <p className="hermes-rooms-muted">
              {rooms.length ? "Không có phòng nào khớp." : "Chưa có phòng nào."}
            </p>
          ) : (
            visibleRooms.map((entry) => (
              <button
                key={entry.roomId}
                type="button"
                className={cn(
                  "hermes-rooms-card",
                  entry.roomId === selected && "is-active",
                )}
                onClick={() => {
                  setSelected(entry.roomId);
                  setEvents([]);
                  setDriver(null);
                  setPending([]);
                  setChatFilter("");
                }}
              >
                <AvatarStack labels={entry.members.map((m) => m.label)} />
                <span className="hermes-rooms-card-body">
                  <strong>{entry.name}</strong>
                  <em>{entry.members.map((m) => m.label).join(" · ")}</em>
                </span>
                <span className="hermes-rooms-card-meta">
                  {roomTimeVi(entry.updatedAt).split(" ")[1] ?? ""}
                  {entry.latestSeq !== null ? <i>{entry.latestSeq}</i> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <button
        type="button"
        className="hermes-rooms-rail-toggle"
        onClick={() => setRailOpen((open) => !open)}
        title={railOpen ? "Thu gọn danh sách phòng" : "Mở danh sách phòng"}
      >
        {railOpen ? (
          <ChevronsLeft className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
      </button>

      <main className="hermes-rooms-main">
        {!room ? (
          <div className="hermes-rooms-blank">
            <MessageSquare className="h-6 w-6" />
            <p>Chọn một phòng bên trái, hoặc tạo phòng mới.</p>
            <p className="hermes-rooms-muted">
              Mỗi thành viên là một profile Hermes riêng. Chúng đọc được lời của
              nhau và gọi nhau bằng <code>@handle</code>.
            </p>
          </div>
        ) : (
          <>
            <header className="hermes-rooms-header">
              <AvatarStack labels={room.members.map((m) => m.label)} large />
              <div className="hermes-rooms-header-title">
                {renaming ? (
                  <RenameField initial={room.name} onDone={rename} onCancel={() => setRenaming(false)} />
                ) : (
                  <strong>{room.name}</strong>
                )}
                <span>
                  <CircleDot
                    className={cn(
                      "h-3 w-3",
                      driver?.working ? "is-live" : undefined,
                    )}
                  />
                  {driver?.working
                    ? "Đang thảo luận"
                    : discussion.outcome
                      ? "Đã kết thúc"
                      : room.disbanded
                        ? "Đã giải tán"
                        : "Đang chờ"}
                  {caps?.protocolVersion ? (
                    <i>Giao thức v{caps.protocolVersion}</i>
                  ) : null}
                </span>
              </div>

              <label className="hermes-rooms-search is-inline">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={chatFilter}
                  onChange={(event) => setChatFilter(event.currentTarget.value)}
                  placeholder="Tìm trong phòng…"
                />
              </label>

              <button
                type="button"
                className="hermes-rooms-icon-button"
                title="Đổi tên phòng"
                onClick={() => setRenaming(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {!room.disbanded ? (
                <button
                  type="button"
                  className="hermes-rooms-icon-button is-danger"
                  disabled={busy === "disband"}
                  title="Giải tán phòng — không hoàn tác được"
                  onClick={() => {
                    if (window.confirm(`Giải tán "${room.name}"? Không hoàn tác được.`)) {
                      void disband();
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Kết thúc
                </button>
              ) : null}
            </header>

            <div className="hermes-rooms-strip">
              <span>
                <Users className="h-3.5 w-3.5" />
                {room.members.length} thành viên
              </span>
              <span>
                Vòng {Math.min(Math.max(1, discussion.rounds), MAX_DISCUSSION_ROUNDS)}/
                {MAX_DISCUSSION_ROUNDS}
              </span>
              {chatFilter.trim() ? (
                <span>{turns.length} tin khớp</span>
              ) : null}
            </div>

            {error ? (
              <p className="hermes-rooms-error">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            ) : null}

            {pending.length ? (
              <div className="hermes-room-pending">
                {pending.map((action) => (
                  <div key={action.taskId}>
                    <span>
                      <AlertCircle className="h-3.5 w-3.5" />
                      {pendingActionVi(action)}
                    </span>
                    <div>
                      {action.kind === "retry" ? (
                        <button
                          type="button"
                          disabled={busy === action.taskId}
                          onClick={() => answer(action, "once")}
                        >
                          Thử lại
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy === action.taskId}
                            onClick={() => answer(action, "once")}
                          >
                            Cho phép một lần
                          </button>
                          <button
                            type="button"
                            className="is-deny"
                            disabled={busy === action.taskId}
                            onClick={() => answer(action, "deny")}
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="hermes-rooms-stream" ref={streamRef}>
              {!turns.length ? (
                <p className="hermes-rooms-muted hermes-rooms-stream-empty">
                  {chatFilter.trim()
                    ? "Không có tin nào khớp."
                    : "Phòng đã sẵn sàng. Nhắn một câu để bắt đầu — gọi thẳng một người bằng @handle, hoặc @all để hỏi cả phòng."}
                </p>
              ) : (
                turns.map((turn) => (
                  <TurnBubble
                    key={`${turn.seq}-${turn.memberId}`}
                    turn={turn}
                    person={people.find((entry) => entry.id === turn.memberId) ?? null}
                  />
                ))
              )}

              {driver?.working ? (
                <p className="hermes-rooms-typing">
                  <span />
                  <span />
                  <span />
                  Đang tới lượt một thành viên…
                </p>
              ) : null}

              {discussion.outcome ? (
                <p
                  className={cn(
                    "hermes-rooms-outcome",
                    discussion.outcome.status === "bounded" && "is-bounded",
                  )}
                >
                  {discussion.outcome.vi}
                </p>
              ) : null}
            </div>

            <div className="hermes-rooms-composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  room.disbanded
                    ? "Phòng đã giải tán."
                    : `Nhắn vào ${room.name}…  (Enter để gửi, Shift+Enter xuống dòng)`
                }
                rows={3}
                disabled={room.disbanded}
              />
              <div className="hermes-rooms-composer-bar">
                <span className="hermes-rooms-mentions">
                  <AtSign className="h-3.5 w-3.5" />
                  {room.members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() =>
                        setDraft(
                          (current) =>
                            `${current}${current && !current.endsWith(" ") ? " " : ""}@${member.label} `,
                        )
                      }
                    >
                      @{member.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDraft(
                        (current) =>
                          `${current}${current && !current.endsWith(" ") ? " " : ""}@all `,
                      )
                    }
                  >
                    @all
                  </button>
                </span>
                <Button
                  disabled={composing || !draft.trim() || room.disbanded}
                  onClick={() => void send()}
                  prefix={
                    composing ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )
                  }
                >
                  Gửi
                </Button>
              </div>
            </div>
          </>
        )}
      </main>

      {room ? (
        <aside className="hermes-rooms-people">
          <h3>Thành viên</h3>
          <ul>
            {people.map((person) => (
              <li key={person.id}>
                <Avatar person={person} />
                <div>
                  <strong>{person.handle}</strong>
                  {person.about ? <p>{person.about}</p> : null}
                  <span className="hermes-rooms-person-meta">
                    <em>{personActivityVi(person)}</em>
                  </span>
                  <MemberModel
                    person={person}
                    roomCount={rooms.length}
                    onChanged={() => setTick((value) => value + 1)}
                  />
                </div>
              </li>
            ))}
          </ul>

          <h3>Cách phòng này chạy</h3>
          <ul className="hermes-rooms-facts">
            <li>
              <Sparkles className="h-3.5 w-3.5" />
              Tối đa {MAX_DISCUSSION_ROUNDS} vòng
            </li>
            <li>
              <MessageSquare className="h-3.5 w-3.5" />
              {MAX_DISCUSSION_MESSAGES} tin nhắn
            </li>
            <li>
              <Check className="h-3.5 w-3.5" />
              Tự kết thúc khi không ai còn gì để nói
            </li>
          </ul>
          {/* No "edit settings" button: these bounds are constants compiled
              into hosted_room_discussion.py, not something a client can set. */}
          <p className="hermes-rooms-muted hermes-rooms-facts-note">
            Ba mức này do Hermes đặt cứng, không chỉnh từ Dashboard được.
          </p>

          {caps ? (
            <p className="hermes-rooms-muted hermes-rooms-facts-note">
              <ShieldCheck className="h-3.5 w-3.5" />
              {caps.roomLinkEnabled
                ? "Có thể mời thành viên từ máy khác."
                : "Phòng chạy nội bộ trên máy này."}
            </p>
          ) : null}
        </aside>
      ) : null}

      {creating ? (
        <NewRoomDialog
          profiles={profiles}
          onClose={() => setCreating(false)}
          onCreate={async (name, members) => {
            const roomId = newRoomId();
            await call("groups.create", {
              members: buildRosterPayload(members),
              name,
              room_id: roomId,
            });
            setTick((value) => value + 1);
            setSelected(roomId);
            setEvents([]);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The model one member speaks with, and a picker to change it.
 *
 * The change is a write to that member's **profile** config — Hermes stores no
 * per-room model — so the panel says so before the click rather than looking
 * like a room setting. See lib/room-member-model.ts for the full reasoning.
 */
function MemberModel({
  person,
  roomCount,
  onChanged,
}: {
  person: RoomPerson;
  roomCount: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ModelChoice[] | null>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "failed">(
    "idle",
  );
  const [applied, setApplied] = useState("");
  const [failure, setFailure] = useState("");

  // Fetched on first open, not at mount: a room panel should not pull the
  // whole provider catalogue for every member just to render a label.
  useEffect(() => {
    if (!open || options !== null) return;
    let alive = true;
    void (async () => {
      try {
        const response = await api.getModelOptions({ profile: person.profile });
        if (!alive) return;
        const rows: ModelChoice[] = [];
        for (const provider of response?.providers ?? []) {
          for (const model of provider.models ?? []) {
            if (typeof model === "string" && model.trim()) {
              rows.push({ id: model.trim(), provider: provider.slug });
            }
          }
        }
        setOptions(rows);
      } catch {
        if (alive) setOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, options, person.profile]);

  const shown = useMemo(
    () => searchModelOptions(query, options ?? [], 30),
    [options, query],
  );

  const choose = (choice: ModelChoice) => {
    const problem = modelProblemVi(choice, person.model);
    if (problem) {
      setFailure(problem);
      return;
    }
    const update = buildModelUpdate(person.profile, choice);
    if (!update) {
      setFailure("Thiếu provider cho model này.");
      return;
    }
    setState("saving");
    setFailure("");
    void api
      .setProfileModel(update.name, update.provider, update.model)
      .then(() => {
        setApplied(update.model);
        setState("done");
        setOpen(false);
        setQuery("");
        onChanged();
      })
      .catch((reason: unknown) => {
        setState("failed");
        setFailure(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <div className="hermes-rooms-member-model">
      <button
        type="button"
        className="hermes-rooms-model-button"
        disabled={state === "saving"}
        title={`Đổi model của @${person.handle}`}
        onClick={() => setOpen((value) => !value)}
      >
        {state === "saving" ? (
          <LoaderCircle className="h-3 w-3 animate-spin" />
        ) : (
          <Cpu className="h-3 w-3" />
        )}
        <code>{person.model ? modelShortLabel(person.model) : "chưa rõ model"}</code>
        <ChevronDown className="h-3 w-3" />
      </button>

      {state !== "idle" && !open ? (
        <em
          className={cn(
            "hermes-rooms-model-state",
            state === "failed" && "is-bad",
          )}
        >
          {applyStateVi(state, modelShortLabel(applied))}
        </em>
      ) : null}

      {open ? (
        <div className="hermes-rooms-model-pop">
          <p className="hermes-rooms-model-warn">
            <AlertCircle className="h-3 w-3" />
            {scopeWarningVi(person.handle, roomCount)}
          </p>

          <input
            autoFocus
            value={query}
            placeholder="Tìm model…"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />

          {options === null ? (
            <p className="hermes-rooms-muted">Đang tải danh sách model…</p>
          ) : !shown.length ? (
            <p className="hermes-rooms-muted">
              {options.length
                ? "Không có model nào khớp."
                : "Không đọc được danh sách model."}
            </p>
          ) : (
            <div className="hermes-rooms-model-list">
              {shown.map((option) => (
                <button
                  key={`${option.provider}/${option.id}`}
                  type="button"
                  className={cn(
                    person.model &&
                      option.id.toLowerCase() === person.model.toLowerCase() &&
                      "is-current",
                  )}
                  onClick={() => choose(option)}
                >
                  <span>{option.id}</span>
                  {option.provider ? <i>{option.provider}</i> : null}
                </button>
              ))}
            </div>
          )}

          {failure ? <p className="hermes-rooms-model-bad">{failure}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ person }: { person: RoomPerson }) {
  return (
    <span className="hermes-rooms-avatar" style={avatarStyle(person)}>
      {person.initials}
    </span>
  );
}

/** Overlapping initials, one per member. */
function AvatarStack({ labels, large }: { labels: string[]; large?: boolean }) {
  return (
    <span className={cn("hermes-rooms-stack", large && "is-large")}>
      {labels.slice(0, 4).map((label) => (
        <span
          key={label}
          style={{
            background: `hsl(${hueFor(label)} 62% 88%)`,
            color: `hsl(${hueFor(label)} 55% 28%)`,
          }}
        >
          {initialsFor(label)}
        </span>
      ))}
    </span>
  );
}

function RenameField({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="hermes-rooms-rename"
      autoFocus
      value={value}
      maxLength={200}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter") void onDone(value);
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

function TurnBubble({
  turn,
  person,
}: {
  turn: DiscussionTurn;
  person: RoomPerson | null;
}) {
  if (turn.who === "you") {
    return (
      <article className="hermes-rooms-turn is-you">
        <header>
          <Crown className="h-3.5 w-3.5" />
          <strong>Anh</strong>
          <time>{roomTimeVi(turn.createdAt)}</time>
        </header>
        <p>{turn.text}</p>
      </article>
    );
  }

  return (
    <article className={cn("hermes-rooms-turn", turn.problem && "is-problem")}>
      {person ? <Avatar person={person} /> : null}
      <div>
        <header>
          <strong>{turn.label}</strong>
          {person?.model ? <code>{person.model}</code> : null}
          {turn.roundIndex !== null ? <em>vòng {turn.roundIndex + 1}</em> : null}
          <time>{roomTimeVi(turn.createdAt)}</time>
        </header>
        {turn.problem ? (
          <p className="hermes-rooms-turn-problem">{turn.problem}</p>
        ) : turn.passed ? (
          <p className="hermes-rooms-turn-passed">(không có gì để nói thêm)</p>
        ) : (
          <p>{turn.text}</p>
        )}
      </div>
    </article>
  );
}

function NewRoomDialog({
  profiles,
  onClose,
  onCreate,
}: {
  profiles: ProfileInfo[];
  onClose: () => void;
  onCreate: (name: string, members: DraftMember[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState("");

  const members = useMemo(
    () =>
      uniqueHandles(
        picked.map((profile) => ({ handle: handleFromProfile(profile), profile })),
      ),
    [picked],
  );
  // The gateway requires a name; a button that refuses to click without saying
  // why is just a broken button.
  const problems = [
    ...(name.trim() ? [] : ["Chưa đặt tên phòng."]),
    ...rosterProblemsVi(members),
  ];

  return (
    <div className="hermes-rooms-modal" role="dialog" aria-label="Phòng mới">
      <div className="hermes-rooms-modal-body">
        <header>
          <strong>Phòng thảo luận mới</strong>
          <button type="button" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </header>

        <label className="hermes-rooms-field">
          <span>Tên phòng</span>
          <input
            autoFocus
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Ví dụ: Rà soát bản phát hành"
          />
        </label>

        <p className="hermes-rooms-field-label">
          Thành viên — chọn {MIN_ROOM_MEMBERS}–{MAX_ROOM_MEMBERS} profile, không
          trùng nhau
        </p>
        <div className="hermes-rooms-pick">
          {!profiles.length ? (
            <span className="hermes-rooms-muted">
              Chưa đọc được danh sách profile.
            </span>
          ) : (
            profiles.map((profile) => {
              const chosen = picked.includes(profile.name);
              return (
                <button
                  key={profile.name}
                  type="button"
                  className={cn(chosen && "is-picked")}
                  onClick={() =>
                    setPicked((current) =>
                      chosen
                        ? current.filter((entry) => entry !== profile.name)
                        : [...current, profile.name],
                    )
                  }
                >
                  {chosen ? <Check className="h-3.5 w-3.5" /> : null}
                  <strong>{profile.display_name || profile.name}</strong>
                  {profile.model ? <code>{profile.model}</code> : null}
                </button>
              );
            })
          )}
        </div>

        {members.length ? (
          <p className="hermes-rooms-handles">
            Trong phòng sẽ gọi nhau là:{" "}
            {members.map((member) => `@${member.handle}`).join(", ")}
          </p>
        ) : null}

        {problems.length ? (
          <ul className="hermes-rooms-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : (
          <p className="hermes-rooms-ready">Đủ điều kiện — bấm tạo phòng.</p>
        )}
        {failed ? <p className="hermes-rooms-error">{failed}</p> : null}

        <Button
          className={cn(problems.length > 0 && "hermes-rooms-create-blocked")}
          title={problems.length ? problems.join(" ") : undefined}
          disabled={saving || problems.length > 0}
          onClick={() => {
            setSaving(true);
            setFailed("");
            onCreate(name.trim(), members)
              .catch((reason: unknown) =>
                setFailed(reason instanceof Error ? reason.message : String(reason)),
              )
              .finally(() => setSaving(false));
          }}
          prefix={
            saving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )
          }
        >
          {saving ? "Đang tạo…" : "Tạo phòng"}
        </Button>
      </div>
    </div>
  );
}
