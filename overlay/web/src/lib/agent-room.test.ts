import { describe, expect, it } from "vitest";

import {
  ACTIVITY_LIMIT,
  agentDoingVi,
  agentKey,
  agentLabelVi,
  applyDelegationStatus,
  EMPTY_AGENT_ROOM,
  elapsedVi,
  hasAgents,
  isAgentEvent,
  isFinished,
  liveAgents,
  reduceAgentRoom,
  roomSummaryVi,
  roomTimeline,
  roomTranscriptText,
  sortedAgents,
  stateFromStatus,
  type AgentFrame,
  type AgentRoom,
} from "./agent-room";

const T0 = Date.parse("2026-09-01T10:00:00Z");

/**
 * A `subagent.*` frame shaped exactly like tui_gateway/server.py:8100 builds
 * it — identity kwargs on every event, optional keys omitted rather than
 * nulled.
 */
function frame(
  type: string,
  payload: Record<string, unknown> = {},
  seq = 1,
): AgentFrame {
  return {
    payload: {
      goal: "Rà soát module thanh toán",
      subagent_id: "sa-0-aaa",
      task_count: 1,
      task_index: 0,
      ...payload,
    },
    seq,
    type,
  };
}

function feed(
  frames: Array<[AgentFrame, number?]>,
  start: AgentRoom = EMPTY_AGENT_ROOM,
): AgentRoom {
  return frames.reduce(
    (room, [item, at]) => reduceAgentRoom(room, item, at ?? T0),
    start,
  );
}

describe("isAgentEvent", () => {
  it("claims the six event types the gateway relays to the parent", () => {
    for (const type of [
      "subagent.spawn_requested",
      "subagent.start",
      "subagent.thinking",
      "subagent.tool",
      "subagent.progress",
      "subagent.complete",
    ]) {
      expect(isAgentEvent(type)).toBe(true);
    }
  });

  it("does not claim subagent.text, which never reaches the parent session", () => {
    // server.py:8158 skips the parent emit for it on purpose.
    expect(isAgentEvent("subagent.text")).toBe(false);
  });

  it("leaves ordinary chat events alone", () => {
    expect(isAgentEvent("message.delta")).toBe(false);
    expect(isAgentEvent("tool.start")).toBe(false);
  });
});

describe("agentKey", () => {
  it("keys on the runtime's own subagent id", () => {
    expect(agentKey({ subagent_id: "sa-1-bbb", task_index: 1 })).toBe("sa-1-bbb");
  });

  it("falls back to the task index rather than inventing a new agent", () => {
    // The emitter declares subagent_id optional; without a fallback each event
    // from such an emitter would spawn a phantom agent.
    expect(agentKey({ task_index: 2 })).toBe("task-2");
    expect(agentKey({})).toBe("task-0");
  });
});

describe("lifecycle", () => {
  it("starts queued on spawn, because the child may be waiting for a slot", () => {
    const room = feed([[frame("subagent.spawn_requested")]]);
    expect(room.agents[0].state).toBe("queued");
    expect(liveAgents(room)).toHaveLength(1);
  });

  it("moves to working only once the child actually starts", () => {
    const room = feed([
      [frame("subagent.spawn_requested")],
      [frame("subagent.start", {}, 2), T0 + 1000],
    ]);
    expect(room.agents[0].state).toBe("working");
    expect(room.agents[0].startedAt).toBe(T0 + 1000);
  });

  it("maps every terminal status the runtime emits", () => {
    expect(stateFromStatus("completed")).toBe("completed");
    expect(stateFromStatus("interrupted")).toBe("interrupted");
    expect(stateFromStatus("timeout")).toBe("timeout");
    expect(stateFromStatus("failed")).toBe("failed");
    expect(stateFromStatus("error")).toBe("failed");
  });

  it("treats an unfamiliar terminal status as a failure, not a success", () => {
    // Hiding an unknown outcome behind "done" is the dangerous direction.
    expect(stateFromStatus("something_new")).toBe("failed");
  });

  it("records the completion rollup", () => {
    const room = feed([
      [frame("subagent.start")],
      [
        frame(
          "subagent.complete",
          {
            api_calls: 12,
            duration_seconds: 42.5,
            files_written: ["a.ts"],
            input_tokens: 6100,
            output_tokens: 900,
            reasoning_tokens: 40,
            status: "completed",
            summary: "Đã rà soát xong",
          },
          2,
        ),
        T0 + 42_500,
      ],
    ]);
    const agent = room.agents[0];
    expect(agent.state).toBe("completed");
    expect(agent.summary).toBe("Đã rà soát xong");
    expect(agent.durationSeconds).toBe(42.5);
    expect(agent.tokens).toEqual({
      apiCalls: 12,
      input: 6100,
      output: 900,
      reasoning: 40,
    });
    expect(agent.filesWritten).toEqual(["a.ts"]);
  });

  it("leaves tokens null while an agent is still running", () => {
    // The gateway strips the live agent object out of the snapshot, so there
    // is no live token figure. Null must not render as a confident zero.
    const room = feed([[frame("subagent.start")], [frame("subagent.tool", {}, 2)]]);
    expect(room.agents[0].tokens).toBeNull();
  });

  it("does not resurrect a finished agent from a later stray event", () => {
    const room = feed([
      [frame("subagent.complete", { status: "completed" })],
      [frame("subagent.thinking", { text: "còn nghĩ gì đó" }, 2)],
    ]);
    expect(room.agents[0].state).toBe("completed");
  });
});

describe("identity merging", () => {
  it("fills fields as later events supply them", () => {
    const room = feed([
      [frame("subagent.spawn_requested")],
      [
        frame("subagent.start", { child_session_id: "child-9", model: "glm-5.3" }, 2),
      ],
    ]);
    expect(room.agents[0]).toMatchObject({
      childSessionId: "child-9",
      model: "glm-5.3",
    });
  });

  it("never erases a field a sparser later event omitted", () => {
    // The emitter omits optional keys rather than sending nulls, so a plain
    // thinking frame must not wipe the model the start frame supplied.
    const room = feed([
      [frame("subagent.start", { child_session_id: "child-9", model: "glm-5.3" })],
      [frame("subagent.thinking", { text: "…" }, 2)],
    ]);
    expect(room.agents[0].model).toBe("glm-5.3");
    expect(room.agents[0].childSessionId).toBe("child-9");
  });

  it("moves the tool counter forward only", () => {
    // A reordered frame carrying a stale count must not walk it backwards.
    const room = feed([
      [frame("subagent.tool", { tool_count: 7 })],
      [frame("subagent.tool", { tool_count: 3 }, 2)],
    ]);
    expect(room.agents[0].toolCount).toBe(7);
  });
});

describe("several agents at once", () => {
  const parallel = () =>
    feed([
      [frame("subagent.start", { subagent_id: "sa-0", task_count: 3, task_index: 0 })],
      [
        frame(
          "subagent.start",
          { goal: "Viết test", subagent_id: "sa-1", task_count: 3, task_index: 1 },
          2,
        ),
      ],
      [
        frame(
          "subagent.start",
          { goal: "Dựng tài liệu", subagent_id: "sa-2", task_count: 3, task_index: 2 },
          3,
        ),
      ],
    ]);

  it("tracks each one separately", () => {
    const room = parallel();
    expect(room.agents).toHaveLength(3);
    expect(liveAgents(room)).toHaveLength(3);
  });

  it("keeps a finished agent visible but sorts it after the running ones", () => {
    let room = parallel();
    room = reduceAgentRoom(
      room,
      frame("subagent.complete", { status: "completed", subagent_id: "sa-0" }, 4),
      T0 + 5_000,
    );
    const order = sortedAgents(room).map((agent) => agent.id);
    expect(order).toEqual(["sa-1", "sa-2", "sa-0"]);
    expect(roomSummaryVi(room)).toBe("2 đang chạy · 1 đã xong");
  });

  it("keeps one agent's failure from touching the others", () => {
    let room = parallel();
    room = reduceAgentRoom(
      room,
      frame("subagent.complete", { status: "error", subagent_id: "sa-1" }, 4),
    );
    expect(room.agents.find((a) => a.id === "sa-1")?.state).toBe("failed");
    expect(room.agents.find((a) => a.id === "sa-2")?.state).toBe("working");
  });

  it("shows a stopped agent as stopped, not as failed", () => {
    let room = parallel();
    room = reduceAgentRoom(
      room,
      frame("subagent.complete", { status: "interrupted", subagent_id: "sa-2" }, 4),
    );
    expect(room.agents.find((a) => a.id === "sa-2")?.state).toBe("interrupted");
  });
});

describe("timeline", () => {
  it("keeps entries in arrival order and can filter to one agent", () => {
    const room = feed([
      [frame("subagent.start", { subagent_id: "sa-0" })],
      [frame("subagent.tool", { subagent_id: "sa-1", tool_name: "read_file" }, 2)],
      [frame("subagent.thinking", { subagent_id: "sa-0", text: "nghĩ" }, 3)],
    ]);
    expect(roomTimeline(room)).toHaveLength(3);
    expect(roomTimeline(room, "sa-0")).toHaveLength(2);
  });

  it("prefers the tool preview as the entry text for a tool call", () => {
    const room = feed([
      [
        frame("subagent.tool", {
          text: "bản sao",
          tool_name: "grep",
          tool_preview: "grep -n TODO",
        }),
      ],
    ]);
    expect(roomTimeline(room)[0].text).toBe("grep -n TODO");
    expect(roomTimeline(room)[0].tool).toBe("grep");
  });

  it("caps the log so a long run cannot grow without bound", () => {
    const frames: Array<[AgentFrame, number?]> = [];
    for (let index = 0; index < ACTIVITY_LIMIT + 40; index += 1) {
      frames.push([frame("subagent.tool", { tool_name: `t${index}` }, index + 1)]);
    }
    const room = feed(frames);
    expect(room.activity).toHaveLength(ACTIVITY_LIMIT);
    // The newest entries are the ones kept.
    expect(room.activity.at(-1)?.tool).toBe(`t${ACTIVITY_LIMIT + 39}`);
  });
});

describe("applyDelegationStatus — reload and reconnect", () => {
  const snapshot = {
    active: [
      {
        depth: 0,
        goal: "Rà soát module thanh toán",
        last_tool: "read_file",
        model: "glm-5.3",
        parent_id: null,
        started_at: T0 / 1000 - 120,
        status: "running",
        subagent_id: "sa-0-aaa",
        tool_count: 9,
      },
    ],
    max_concurrent_children: 3,
    max_spawn_depth: 1,
    paused: false,
  };

  it("recovers an agent that started before the page opened", () => {
    const room = applyDelegationStatus(EMPTY_AGENT_ROOM, snapshot);
    expect(room.agents).toHaveLength(1);
    expect(room.agents[0]).toMatchObject({
      model: "glm-5.3",
      state: "working",
      toolCount: 9,
    });
    // started_at is epoch SECONDS on the Python side.
    expect(room.agents[0].startedAt).toBe(T0 - 120_000);
  });

  it("merges into an agent the live feed already knows, without duplicating", () => {
    const live = feed([[frame("subagent.start", { subagent_id: "sa-0-aaa" })]]);
    const room = applyDelegationStatus(live, snapshot);
    expect(room.agents).toHaveLength(1);
    expect(room.agents[0].toolCount).toBe(9);
  });

  it("does not delete an agent that finished and left the snapshot", () => {
    // The runtime removes an entry on completion rather than marking it, so a
    // finished agent is simply absent — that must not erase its record.
    const done = feed([
      [frame("subagent.complete", { status: "completed", subagent_id: "sa-9" })],
    ]);
    const room = applyDelegationStatus(done, snapshot);
    expect(room.agents).toHaveLength(2);
    expect(room.agents.find((a) => a.id === "sa-9")?.state).toBe("completed");
  });

  it("does not resurrect a finished agent that lingers in the snapshot", () => {
    const done = feed([
      [frame("subagent.complete", { status: "completed", subagent_id: "sa-0-aaa" })],
    ]);
    const room = applyDelegationStatus(done, snapshot);
    expect(room.agents[0].state).toBe("completed");
  });

  it("ignores the snapshot's own status field", () => {
    // list_active_subagents() writes "running" at registration and never
    // updates it, so it says "running" for everything it returns.
    const room = applyDelegationStatus(EMPTY_AGENT_ROOM, {
      active: [{ status: "running", subagent_id: "sa-x" }],
    });
    expect(room.agents[0].state).toBe("working");
  });

  it("reads the spawn-pause flag and the runtime limits", () => {
    const room = applyDelegationStatus(EMPTY_AGENT_ROOM, {
      ...snapshot,
      paused: true,
    });
    expect(room).toMatchObject({ maxConcurrent: 3, maxDepth: 1, paused: true });
  });

  it("survives a reply that is not one", () => {
    expect(applyDelegationStatus(EMPTY_AGENT_ROOM, null)).toBe(EMPTY_AGENT_ROOM);
    expect(applyDelegationStatus(EMPTY_AGENT_ROOM, { active: "no" }).agents).toEqual(
      [],
    );
  });
});

describe("no sub-agents at all", () => {
  it("stays empty, so the chat can hide the panel entirely", () => {
    expect(hasAgents(EMPTY_AGENT_ROOM)).toBe(false);
    expect(roomSummaryVi(EMPTY_AGENT_ROOM)).toContain("Chưa có agent phụ");
  });

  it("ignores frames that are not sub-agent events", () => {
    const room = reduceAgentRoom(
      EMPTY_AGENT_ROOM,
      { payload: { text: "hi" }, seq: 1, type: "message.delta" },
      T0,
    );
    expect(room).toBe(EMPTY_AGENT_ROOM);
  });

  it("ignores a sub-agent frame with no payload", () => {
    const room = reduceAgentRoom(
      EMPTY_AGENT_ROOM,
      { payload: null, seq: 1, type: "subagent.start" },
      T0,
    );
    expect(room).toBe(EMPTY_AGENT_ROOM);
  });
});

describe("labels", () => {
  it("names an agent by its goal, since the runtime assigns no role", () => {
    const room = feed([[frame("subagent.start")]]);
    expect(agentLabelVi(room.agents[0])).toBe("Rà soát module thanh toán");
  });

  it("trims a long goal instead of letting it break the card", () => {
    const room = feed([[frame("subagent.start", { goal: "x".repeat(200) })]]);
    expect(agentLabelVi(room.agents[0]).length).toBeLessThan(70);
    expect(agentLabelVi(room.agents[0]).endsWith("…")).toBe(true);
  });

  it("falls back to a task number when there is no goal text", () => {
    const room = feed([[frame("subagent.start", { goal: "", task_count: 3 })]]);
    expect(agentLabelVi(room.agents[0])).toBe("Tác vụ 1");
  });

  it("says what the agent is doing right now", () => {
    const queued = feed([[frame("subagent.spawn_requested")]]);
    expect(agentDoingVi(queued.agents[0])).toContain("đợi chỗ trống");

    const working = feed([[frame("subagent.tool", { tool_name: "read_file" })]]);
    expect(agentDoingVi(working.agents[0])).toBe("Đang dùng read_file");

    const done = feed([
      [frame("subagent.complete", { status: "completed", summary: "Xong rồi" })],
    ]);
    expect(agentDoingVi(done.agents[0])).toBe("Xong rồi");
  });
});

describe("elapsedVi", () => {
  it("counts up from the start while running", () => {
    const room = feed([[frame("subagent.start")]]);
    expect(elapsedVi(room.agents[0], T0 + 95_000)).toBe("01:35");
  });

  it("prefers the runtime's own duration once reported", () => {
    const room = feed([
      [frame("subagent.start")],
      [frame("subagent.complete", { duration_seconds: 42, status: "completed" }, 2)],
    ]);
    expect(elapsedVi(room.agents[0], T0 + 999_999)).toBe("00:42");
  });

  it("shows nothing rather than a fake clock before anything started", () => {
    const room = feed([[frame("subagent.spawn_requested")]]);
    expect(elapsedVi(room.agents[0], T0)).toBe("");
  });
});

describe("roomTranscriptText", () => {
  it("exports what the panel shows", () => {
    const room = feed([
      [frame("subagent.start")],
      [frame("subagent.tool", { tool_name: "read_file" }, 2)],
      [
        frame(
          "subagent.complete",
          { duration_seconds: 12, status: "completed", summary: "Xong" },
          3,
        ),
      ],
    ]);
    const text = roomTranscriptText(room, T0);
    expect(text).toContain("Biên bản phòng họp Agents");
    expect(text).toContain("Rà soát module thanh toán");
    expect(text).toContain("Hoàn thành");
    expect(text).toContain("read_file");
  });

  it("omits the token line when the runtime never reported one", () => {
    const room = feed([[frame("subagent.start")]]);
    expect(roomTranscriptText(room, T0)).not.toContain("Token:");
  });
});

describe("isFinished", () => {
  it("counts only terminal states", () => {
    expect(isFinished("queued")).toBe(false);
    expect(isFinished("working")).toBe(false);
    expect(isFinished("completed")).toBe(true);
    expect(isFinished("failed")).toBe(true);
    expect(isFinished("interrupted")).toBe(true);
    expect(isFinished("timeout")).toBe(true);
  });
});
