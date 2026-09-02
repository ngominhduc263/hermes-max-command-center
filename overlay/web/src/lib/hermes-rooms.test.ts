import { describe, expect, it } from "vitest";

import {
  parseDriverStatus,
  parseMembers,
  parseRoom,
  parseRoomCapabilities,
  parseRoomEvent,
  parseRoomList,
  parseRoomLog,
  parseRoomState,
  roomEventSummary,
  roomEventVi,
  roomTimeVi,
} from "./hermes-rooms";

/** A row shaped like gateway/hosted_rooms.py's `_room_from_row`. */
function room(overrides: Record<string, unknown> = {}) {
  return {
    authority_epoch: 2,
    authority_gateway_id: "gw-home",
    created_at: 1_756_000_000,
    idempotent: false,
    latest_seq: 41,
    members: [
      { handle: "hermes", member_id: "default", profile: "default" },
      { handle: "ops", member_id: "ops", profile: "ops" },
    ],
    name: "Nhóm dự án",
    revision: 7,
    room_id: "room-1",
    updated_at: 1_756_000_900,
    ...overrides,
  };
}

describe("parseRoom", () => {
  it("reads the row the gateway stores", () => {
    expect(parseRoom(room())).toEqual({
      authorityEpoch: 2,
      authorityGatewayId: "gw-home",
      createdAt: 1_756_000_000,
      disbanded: false,
      latestSeq: 41,
      members: [
        { id: "default", label: "hermes", profile: "default" },
        { id: "ops", label: "ops", profile: "ops" },
      ],
      name: "Nhóm dự án",
      revision: 7,
      roomId: "room-1",
      updatedAt: 1_756_000_900,
    });
  });

  it("falls back to the id when a room has no name", () => {
    expect(parseRoom(room({ name: "  " }))?.name).toBe("room-1");
  });

  it("marks a disbanded room", () => {
    expect(parseRoom(room({ disbanded_at: 1_756_001_000 }))?.disbanded).toBe(true);
  });

  it("refuses a row with no room_id", () => {
    expect(parseRoom(room({ room_id: "" }))).toBeNull();
    expect(parseRoom(null)).toBeNull();
    expect(parseRoom([1, 2])).toBeNull();
  });

  it("survives a row missing the optional sequence", () => {
    // `_room_from_row` only sets latest_seq when the query selected next_seq.
    expect(parseRoom(room({ latest_seq: undefined }))?.latestSeq).toBeNull();
  });
});

describe("parseMembers", () => {
  it("prefers the handle as the label but keeps member_id as the identity", () => {
    expect(
      parseMembers([{ handle: "ops", member_id: "ops-1", profile: "ops" }]),
    ).toEqual([{ id: "ops-1", label: "ops", profile: "ops" }]);
  });

  it("falls back through the other names a member row might carry", () => {
    expect(parseMembers([{ display_name: "Máy bàn", member_id: "peer-1" }])).toEqual([
      { id: "peer-1", label: "Máy bàn", profile: "" },
    ]);
  });

  it("takes a plain string id, since only the gateway enforces objects", () => {
    expect(parseMembers(["a", " b "])).toEqual([
      { id: "a", label: "a", profile: "" },
      { id: "b", label: "b", profile: "" },
    ]);
  });

  it("skips members it cannot name rather than rendering blanks", () => {
    expect(parseMembers([{}, "", null, 7, "ok"])).toEqual([
      { id: "ok", label: "ok", profile: "" },
    ]);
  });

  it("returns nothing for a non-list", () => {
    expect(parseMembers("haruto")).toEqual([]);
  });
});

describe("parseRoomList", () => {
  it("puts the most recently active room first", () => {
    const rooms = parseRoomList({
      next_offset: null,
      rooms: [
        room({ room_id: "old", updated_at: 1 }),
        room({ room_id: "new", updated_at: 999 }),
      ],
    });
    expect(rooms.map((entry) => entry.roomId)).toEqual(["new", "old"]);
  });

  it("drops duplicates and unusable rows", () => {
    const rooms = parseRoomList({
      rooms: [room(), room(), room({ room_id: "" }), null],
    });
    expect(rooms).toHaveLength(1);
  });

  it("returns nothing for a reply that is not one", () => {
    expect(parseRoomList({})).toEqual([]);
    expect(parseRoomList({ rooms: "no" })).toEqual([]);
    expect(parseRoomList(null)).toEqual([]);
  });
});

describe("parseRoomState", () => {
  it("unwraps the room the reply nests under `room`", () => {
    const state = parseRoomState({ room: room() });
    expect(state.room?.roomId).toBe("room-1");
    expect(state.driver).toBeNull();
  });

  it("reads the driver status when this gateway runs the driver", () => {
    const state = parseRoomState({
      driver_status: {
        blocked: false,
        counts: { queued: 2, running: 1 },
        pending_actions: [{ kind: "retry", task_id: "t-1" }],
        peer_routes: {},
        running: true,
        working: true,
      },
      room: room(),
    });
    expect(state.driver).toEqual({
      blocked: false,
      counts: { queued: 2, running: 1 },
      pendingActions: 1,
      running: true,
      working: true,
    });
  });

  it("copes with a disbanded room, where driver_status is absent", () => {
    const state = parseRoomState({ room: room({ disbanded_at: 1 }) });
    expect(state.room?.disbanded).toBe(true);
    expect(state.driver).toBeNull();
  });

  it("returns nothing for a reply that is not one", () => {
    expect(parseRoomState(null)).toEqual({ driver: null, room: null });
  });
});

describe("parseDriverStatus", () => {
  it("ignores counts that are not numbers instead of rendering NaN", () => {
    expect(parseDriverStatus({ counts: { bad: "x", ok: 3 } })?.counts).toEqual({
      ok: 3,
    });
  });
});

describe("parseRoomEvent / parseRoomLog", () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    actor: { display_name: "Haruto", id: "desktop", kind: "user" },
    authority_epoch: 1,
    created_at: 1_756_000_500,
    event_id: "ev-1",
    kind: "message.user",
    payload: { text: "chào cả nhà" },
    room_id: "room-1",
    seq: 12,
    ...overrides,
  });

  it("reads an event and names its actor", () => {
    expect(parseRoomEvent(event())).toMatchObject({
      actor: "desktop",
      actorKind: "user",
      actorLabel: "Haruto",
      kind: "message.user",
      seq: 12,
    });
  });

  it("falls back to the actor id when there is no display name", () => {
    const parsed = parseRoomEvent(
      event({ actor: { id: "authority-control", kind: "system" } }),
    );
    expect(parsed?.actorLabel).toBe("authority-control");
  });

  it("takes a plain-string actor too", () => {
    expect(parseRoomEvent(event({ actor: "hermes" }))?.actor).toBe("hermes");
  });

  it("refuses an event with no sequence, since the log is ordered by it", () => {
    expect(parseRoomEvent(event({ seq: null }))).toBeNull();
    expect(parseRoomEvent(event({ seq: "12" }))).toBeNull();
  });

  it("shows the newest event first and keeps the gateway's cursor", () => {
    // read_events returns oldest-first with cursor = the last seq on the page.
    const page = parseRoomLog({
      authority: { epoch: 1, gateway_id: "gw-home" },
      cursor: 9,
      events: [event({ seq: 1 }), event({ seq: 5 }), event({ seq: 9 })],
      has_more: true,
      latest_seq: 41,
    });
    expect(page.events.map((entry) => entry.seq)).toEqual([9, 5, 1]);
    expect(page).toMatchObject({ cursor: 9, hasMore: true, latestSeq: 41 });
  });

  it("returns an empty page for a reply that is not one", () => {
    expect(parseRoomLog({ events: {} })).toEqual({
      cursor: 0,
      events: [],
      hasMore: false,
      latestSeq: 0,
    });
    expect(parseRoomLog(null).events).toEqual([]);
  });
});

describe("parseRoomCapabilities", () => {
  it("reads a gateway that supports rooms", () => {
    // Field names as `groups.capabilities` actually emits them — note the
    // driver flag is `driver`, not `driver_ready`.
    const caps = parseRoomCapabilities({
      authority_gateway_id: "gw-home",
      driver: true,
      max_log_limit: 500,
      methods: ["groups.list", "groups.state"],
      protocol_version: 2,
      room_link: { enabled: true, profile: "default" },
    });
    expect(caps).toMatchObject({
      authorityGatewayId: "gw-home",
      available: true,
      driverReady: true,
      maxLogLimit: 500,
      methods: ["groups.list", "groups.state"],
      protocolVersion: "2",
      reason: "",
      roomLinkEnabled: true,
    });
  });

  it("reads a gateway where cross-machine linking is off", () => {
    const caps = parseRoomCapabilities({
      driver: true,
      room_link: {
        enabled: false,
        reason: "gateway_roomlink_secret_unavailable",
      },
    });
    expect(caps.roomLinkEnabled).toBe(false);
    // The gateway returns a bare code; the user gets a sentence.
    expect(caps.reason).toContain("khoá bí mật");
  });

  it("shows an unfamiliar reason code rather than swallowing it", () => {
    const caps = parseRoomCapabilities({ room_link: { reason: "something_new" } });
    expect(caps.reason).toBe("something_new");
  });

  it("says unavailable when the reply is not a record", () => {
    // An older gateway rejects the method outright; the caller maps that to
    // this same shape, so both paths end up saying the same thing.
    expect(parseRoomCapabilities(null).available).toBe(false);
    expect(parseRoomCapabilities("nope").reason).toContain("Nhóm");
  });
});

describe("roomEventVi / roomEventSummary", () => {
  it("translates the kinds the log records", () => {
    expect(roomEventVi("authority.claimed")).toContain("quyền điều phối");
    expect(roomEventVi("room.renamed")).toContain("đổi tên");
    expect(roomEventVi("turn.settled")).toContain("hoàn tất");
  });

  it("shows an unknown kind verbatim rather than hiding it", () => {
    expect(roomEventVi("something.new")).toBe("something.new");
  });

  const base = {
    activityReason: "",
    activityStatus: "",
    actor: "a",
    actorKind: "user",
    actorLabel: "a",
    createdAt: null,
    detail: "",
    eventId: "e",
    memberId: "",
    memberText: "",
    passed: false,
    roundIndex: null,
    seq: 1,
  };

  it("pulls the readable part out of a payload", () => {
    expect(
      roomEventSummary({ ...base, kind: "message.user", payload: { text: "chào" } }),
    ).toBe("chào");
  });

  it("names the keys when the payload has no obvious text", () => {
    expect(
      roomEventSummary({ ...base, kind: "x", payload: { epoch: 2, gateway: "gw" } }),
    ).toBe("(epoch, gateway)");
  });

  it("truncates a very long message instead of flooding the row", () => {
    const summary = roomEventSummary({
      ...base,
      kind: "message.user",
      payload: { text: "x".repeat(400) },
    });
    expect(summary.length).toBeLessThan(200);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("roomTimeVi", () => {
  it("treats the gateway's float seconds as seconds, not milliseconds", () => {
    // 1756000000s is 2025; the same number read as ms would be 1970.
    expect(roomTimeVi(1_756_000_000)).toContain("2025");
  });

  it("shows nothing rather than 'Invalid Date'", () => {
    expect(roomTimeVi(null)).toBe("");
    expect(roomTimeVi(Number.NaN)).toBe("");
  });
});

/* ── The writable side ───────────────────────────────────────────────────── */

import {
  buildDiscussion,
  buildRosterPayload,
  handleFromProfile,
  MAX_ROOM_MEMBERS,
  newEventId,
  newRoomId,
  parsePendingActions,
  pendingActionVi,
  rosterProblemsVi,
  uniqueHandles,
} from "./hermes-rooms";

/** An event row with the discussion coordinates the real log carries. */
function discussionEvent(
  kind: string,
  payload: Record<string, unknown>,
  seq: number,
) {
  return parseRoomEvent({
    actor: { id: "ops", kind: "member" },
    created_at: 1_756_000_000 + seq,
    event_id: `ev-${seq}`,
    kind,
    payload,
    room_id: "room-1",
    seq,
  })!;
}

const roster = [
  { id: "default", label: "hermes", profile: "default" },
  { id: "ops", label: "ops", profile: "ops" },
];

describe("buildDiscussion", () => {
  it("reads as a conversation, not an event log", () => {
    const events = [
      discussionEvent("message.user", { text: "@ops xem bản phát hành", thread_id: "t1" }, 1),
      discussionEvent(
        "message.member",
        { member_id: "ops", round_index: 0, text: "Đã xem, có hai lỗi.", thread_id: "t1" },
        2,
      ),
      // The settled event carries no words — they already arrived above.
      discussionEvent(
        "turn.settled",
        { member_id: "ops", passed: false, round_index: 0, thread_id: "t1" },
        3,
      ),
    ];
    const discussion = buildDiscussion(events, roster);
    expect(discussion.turns).toHaveLength(2);
    expect(discussion.turns[0]).toMatchObject({ label: "Anh", who: "you" });
    expect(discussion.turns[1]).toMatchObject({
      label: "ops",
      text: "Đã xem, có hai lỗi.",
      who: "member",
    });
  });

  it("shows a member that passed, since silence is a real answer", () => {
    const events = [
      discussionEvent(
        "turn.settled",
        { member_id: "default", passed: true, round_index: 1 },
        4,
      ),
    ];
    const discussion = buildDiscussion(events, roster);
    expect(discussion.turns[0]).toMatchObject({ label: "hermes", passed: true });
  });

  it("attaches a failed turn to the member it belongs to", () => {
    const events = [
      discussionEvent(
        "turn.failed",
        { error: "hết giờ", member_id: "ops", round_index: 0 },
        5,
      ),
    ];
    expect(buildDiscussion(events, roster).turns[0].problem).toContain("hết giờ");
  });

  it("says a deferred turn needs a person", () => {
    const events = [
      discussionEvent(
        "turn.deferred",
        { execution_generation: 1, member_id: "ops", reason: "member_unavailable" },
        6,
      ),
    ];
    expect(buildDiscussion(events, roster).turns[0].problem).toContain("Thử lại");
  });

  it("explains a bounded ending as the design, not a fault", () => {
    const events = [
      discussionEvent(
        "room.activity",
        { discussion_event_id: "d1", reason_code: "max_rounds", status: "bounded", thread_id: "t1" },
        7,
      ),
    ];
    const discussion = buildDiscussion(events, roster);
    expect(discussion.outcome).toMatchObject({ status: "bounded" });
    expect(discussion.outcome?.vi).toContain("3 vòng");
  });

  it("counts the rounds so the UI can say how far along it is", () => {
    const events = [
      discussionEvent("message.member", { member_id: "ops", round_index: 0, text: "a" }, 1),
      discussionEvent("message.member", { member_id: "default", round_index: 2, text: "b" }, 2),
    ];
    expect(buildDiscussion(events, roster).rounds).toBe(3);
  });

  it("falls back to the raw member id when the roster does not name them", () => {
    const events = [
      discussionEvent("message.member", { member_id: "ghost", text: "hi" }, 1),
    ];
    expect(buildDiscussion(events, roster).turns[0].label).toBe("ghost");
  });

  it("sorts by sequence, so a page read out of order still reads right", () => {
    const events = [
      discussionEvent("message.member", { member_id: "ops", text: "sau" }, 9),
      discussionEvent("message.user", { text: "trước" }, 1),
    ];
    expect(buildDiscussion(events, roster).turns.map((t) => t.text)).toEqual([
      "trước",
      "sau",
    ]);
  });
});

describe("handleFromProfile / uniqueHandles", () => {
  it("strips a profile name down to what the gateway accepts", () => {
    // The gateway's _IDENTIFIER_RE rejects spaces, diacritics and symbols.
    expect(handleFromProfile("Trợ lý Kế toán")).toBe("TrolyKetoan");
    expect(handleFromProfile("ops-2")).toBe("ops-2");
  });

  it("never returns something the gateway would reject", () => {
    expect(handleFromProfile("！！！")).toBe("agent");
    expect(handleFromProfile("")).toBe("agent");
    expect(handleFromProfile("_leading")).toBe("leading");
  });

  it("disambiguates collisions instead of letting the room be refused", () => {
    const handles = uniqueHandles([
      { handle: "ops", profile: "ops" },
      { handle: "ops", profile: "ops-backup" },
      { handle: "ops", profile: "ops-third" },
    ]);
    expect(handles.map((m) => m.handle)).toEqual(["ops", "ops2", "ops3"]);
  });
});

describe("rosterProblemsVi", () => {
  const ok = [
    { handle: "hermes", profile: "default" },
    { handle: "ops", profile: "ops" },
  ];

  it("passes a legal roster", () => {
    expect(rosterProblemsVi(ok)).toEqual([]);
  });

  it("needs at least two, because one agent is not a discussion", () => {
    expect(rosterProblemsVi([ok[0]])[0]).toContain("ít nhất 2");
  });

  it("caps at six", () => {
    const many = Array.from({ length: MAX_ROOM_MEMBERS + 1 }, (_, i) => ({
      handle: `a${i}`,
      profile: `p${i}`,
    }));
    expect(rosterProblemsVi(many).join(" ")).toContain("Tối đa 6");
  });

  it("rejects the handles Hermes reserves for addressing everyone", () => {
    expect(
      rosterProblemsVi([{ handle: "all", profile: "p1" }, ok[1]]).join(" "),
    ).toContain("giữ riêng");
    expect(
      rosterProblemsVi([{ handle: "Everyone", profile: "p1" }, ok[1]]).join(" "),
    ).toContain("giữ riêng");
  });

  it("rejects a handle the gateway's pattern would refuse", () => {
    expect(
      rosterProblemsVi([{ handle: "kế toán", profile: "p1" }, ok[1]]).join(" "),
    ).toContain("không hợp lệ");
  });

  it("catches duplicate handles and duplicate profiles", () => {
    expect(
      rosterProblemsVi([
        { handle: "ops", profile: "a" },
        { handle: "OPS", profile: "b" },
      ]).join(" "),
    ).toContain("trùng");
    expect(
      rosterProblemsVi([
        { handle: "a", profile: "same" },
        { handle: "b", profile: "same" },
      ]).join(" "),
    ).toContain("đã được dùng");
  });
});

describe("buildRosterPayload", () => {
  it("sends exactly the three fields groups.create requires", () => {
    // `target` is deliberately omitted: omitting it means "local", and the
    // gateway fills it in after checking the profile exists here.
    expect(
      buildRosterPayload([{ handle: " ops ", profile: " ops " }]),
    ).toEqual([{ handle: "ops", member_id: "ops", profile: "ops" }]);
  });
});

describe("newRoomId / newEventId", () => {
  it("makes ids the gateway's identifier pattern accepts", () => {
    const pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
    expect(newRoomId()).toMatch(pattern);
    expect(newEventId()).toMatch(pattern);
  });

  it("does not repeat itself", () => {
    expect(newRoomId()).not.toBe(newRoomId());
  });
});

describe("parsePendingActions", () => {
  it("reads both kinds, which are answered by different calls", () => {
    const actions = parsePendingActions([
      { kind: "retry", task_id: "t-1" },
      {
        approval: { description: "xoá thư mục build" },
        kind: "approval",
        member_id: "ops",
        request_id: "r-1",
        task_id: "t-2",
      },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toMatchObject({
      kind: "approval",
      memberId: "ops",
      requestId: "r-1",
      what: "xoá thư mục build",
    });
  });

  it("ignores an action kind it does not know how to answer", () => {
    expect(parsePendingActions([{ kind: "something_new" }])).toEqual([]);
    expect(parsePendingActions(null)).toEqual([]);
  });

  it("says what the room needs, even with no description", () => {
    expect(pendingActionVi({ kind: "retry", memberId: "", requestId: "", taskId: "t", what: "" }))
      .toContain("kẹt");
    expect(
      pendingActionVi({ kind: "approval", memberId: "", requestId: "", taskId: "t", what: "" }),
    ).toContain("xin phép");
  });
});
