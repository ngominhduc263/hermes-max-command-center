// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The panel is easy to make look impressive and wrong, so these tests pin the
 * places where it must stay honest: no invented progress number, no invented
 * job titles, no agent-to-agent dialogue (Hermes isolates sub-agents entirely),
 * and no control that the runtime cannot actually perform.
 */

import {
  EMPTY_AGENT_ROOM,
  reduceAgentRoom,
  type AgentRoom as AgentRoomState,
  type RoomAgent,
} from "@/lib/agent-room";

const T0 = Date.parse("2026-09-01T10:00:00Z");

function feed(
  frames: Array<{ type: string; payload: Record<string, unknown>; seq?: number }>,
  at = T0,
): AgentRoomState {
  return frames.reduce(
    (room, item, index) =>
      reduceAgentRoom(
        room,
        { payload: item.payload, seq: item.seq ?? index + 1, type: item.type },
        at + index * 1000,
      ),
    EMPTY_AGENT_ROOM,
  );
}

const twoAgents = () =>
  feed([
    {
      payload: {
        goal: "Rà soát module thanh toán",
        model: "glm-5.3",
        subagent_id: "sa-0",
        task_count: 2,
        task_index: 0,
        tool_count: 4,
      },
      type: "subagent.start",
    },
    {
      payload: {
        goal: "Viết test hồi quy",
        model: "deepseek-v4",
        subagent_id: "sa-1",
        task_count: 2,
        task_index: 1,
      },
      type: "subagent.start",
    },
  ]);

let container: HTMLDivElement;
let root: Root;

async function mount(props: {
  room?: AgentRoomState;
  onStopAgent?: (agent: RoomAgent) => Promise<boolean>;
  onPauseSpawn?: (paused: boolean) => Promise<boolean>;
  disconnected?: boolean;
  onLoadChildTranscript?: (
    sessionId: string,
  ) => Promise<Array<{ role: string; content: string | null }>>;
}) {
  const { AgentRoom } = await import("./AgentRoom");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentRoom
        room={props.room ?? twoAgents()}
        onStopAgent={props.onStopAgent}
        onPauseSpawn={props.onPauseSpawn}
        disconnected={props.disconnected}
        onLoadChildTranscript={props.onLoadChildTranscript}
      />,
    ),
  );
}

const text = () => container.textContent ?? "";

async function click(label: string, index = 0) {
  const buttons = [...container.querySelectorAll("button")];
  const exact = buttons.filter((b) => b.textContent?.trim() === label);
  const targets = exact.length
    ? exact
    : buttons.filter((b) => b.textContent?.includes(label));
  expect(targets[index], `no button matching "${label}"`).toBeDefined();
  await act(async () => {
    targets[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AgentRoom", () => {
  it("shows each agent with its real goal, model and state", async () => {
    await mount({});
    expect(text()).toContain("Rà soát module thanh toán");
    expect(text()).toContain("Viết test hồi quy");
    expect(text()).toContain("glm-5.3");
    expect(text()).toContain("Đang làm việc");
  });

  it("labels agents by goal and never invents a job title", async () => {
    // The runtime assigns no role; a child has an id and a goal. Rendering
    // "Kiến trúc sư" would be a persona Hermes never created.
    await mount({});
    expect(text()).not.toContain("Kiến trúc sư");
    expect(text()).not.toContain("Lập trình viên");
  });

  it("shows no progress percentage, because the runtime computes none", async () => {
    await mount({});
    expect(text()).not.toMatch(/\d+%/);
  });

  it("shows the real progress signals instead", async () => {
    await mount({});
    expect(text()).toContain("4 lần gọi công cụ");
  });

  it("says plainly that sub-agents do not talk to each other", async () => {
    await mount({});
    expect(text()).toContain("không trao đổi trực tiếp với nhau");
  });

  it("offers the three views", async () => {
    await mount({});
    expect(text()).toContain("Diễn biến trực tiếp");
    expect(text()).toContain("Tóm tắt");
    expect(text()).toContain("Nhật ký quyết định");
  });

  it("filters the stream to one agent when its card is picked", async () => {
    const room = feed([
      {
        payload: { goal: "Nhiệm vụ Alpha", subagent_id: "sa-0" },
        type: "subagent.start",
      },
      {
        payload: {
          goal: "Nhiệm vụ Beta",
          subagent_id: "sa-1",
          tool_name: "grep",
        },
        type: "subagent.tool",
      },
    ]);
    await mount({ room });
    // Click the card itself rather than matching on label text, which would
    // also match the panel header.
    const card = container.querySelector(".hermes-agent-card") as HTMLButtonElement;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text()).toContain("Chỉ xem: Nhiệm vụ Alpha");
    // sa-1's tool call is filtered out of the stream.
    expect(container.querySelectorAll(".hermes-agent-room-stream li")).toHaveLength(
      1,
    );
  });

  it("shows a typing indicator while agents are still working", async () => {
    await mount({});
    expect(text()).toContain("agent đang làm việc");
  });

  it("drops the typing indicator once everything has finished", async () => {
    const room = feed([
      { payload: { subagent_id: "sa-0" }, type: "subagent.start" },
      {
        payload: { status: "completed", subagent_id: "sa-0", summary: "Xong" },
        type: "subagent.complete",
      },
    ]);
    await mount({ room });
    expect(text()).not.toContain("đang làm việc…");
  });

  it("distinguishes a stopped agent from a failed one", async () => {
    const room = feed([
      { payload: { goal: "A", subagent_id: "sa-0" }, type: "subagent.start" },
      {
        payload: { goal: "A", status: "interrupted", subagent_id: "sa-0" },
        type: "subagent.complete",
      },
    ]);
    await mount({ room });
    expect(text()).toContain("Đã dừng");
    expect(text()).not.toContain("Thất bại");
  });

  it("stops one agent through the runtime's own call", async () => {
    const onStopAgent = vi.fn<(agent: RoomAgent) => Promise<boolean>>(
      async () => true,
    );
    await mount({ onStopAgent });
    const stop = container.querySelector(
      ".hermes-agent-card-stop",
    ) as HTMLButtonElement;
    expect(stop).toBeTruthy();
    await act(async () => {
      stop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onStopAgent).toHaveBeenCalledTimes(1);
    expect(onStopAgent.mock.calls[0][0]).toMatchObject({ subagentId: "sa-0" });
  });

  it("hides the stop button for an agent that already finished", async () => {
    const room = feed([
      { payload: { subagent_id: "sa-0" }, type: "subagent.start" },
      {
        payload: { status: "completed", subagent_id: "sa-0" },
        type: "subagent.complete",
      },
    ]);
    await mount({ onStopAgent: async () => true, room });
    expect(container.querySelector(".hermes-agent-card-stop")).toBeNull();
  });

  it("shows no controls at all when the gateway cannot be reached", async () => {
    // A decorative button that silently does nothing is worse than no button.
    await mount({});
    expect(container.querySelector(".hermes-agent-card-stop")).toBeNull();
    expect(text()).not.toContain("Ngưng giao việc mới");
  });

  it("pauses new spawns, and says that is what it does", async () => {
    const onPauseSpawn = vi.fn<(paused: boolean) => Promise<boolean>>(
      async () => true,
    );
    await mount({ onPauseSpawn });
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ngưng giao việc mới"),
    );
    // Pausing a single running agent does not exist in Hermes; this is the
    // spawn gate, and the tooltip has to say so.
    expect(button?.getAttribute("title")).toContain("agent mới");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPauseSpawn).toHaveBeenCalledWith(true);
  });

  it("says the feed dropped without pretending the agents stopped", async () => {
    await mount({ disconnected: true });
    expect(text()).toContain("Mất kết nối");
    expect(text()).toContain("agent vẫn chạy trong Hermes");
    // They are still shown as working, because they are.
    expect(text()).toContain("Đang làm việc");
  });

  it("collapses so a long run does not squeeze the composer", async () => {
    await mount({});
    await click("Phòng họp Agents");
    expect(container.querySelector(".hermes-agent-room-body")).toBeNull();
  });

  it("copies the minutes to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined,
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mount({});
    await click("Sao chép");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("Biên bản phòng họp Agents");
    vi.unstubAllGlobals();
  });

  it("shows the summary view with what each agent reported", async () => {
    const room = feed([
      { payload: { goal: "A", subagent_id: "sa-0" }, type: "subagent.start" },
      {
        payload: {
          duration_seconds: 12,
          goal: "A",
          input_tokens: 900,
          output_tokens: 100,
          status: "completed",
          subagent_id: "sa-0",
          summary: "Đã kiểm tra xong toàn bộ",
        },
        type: "subagent.complete",
      },
    ]);
    await mount({ room });
    await click("Tóm tắt");
    expect(text()).toContain("Đã kiểm tra xong toàn bộ");
    expect(text()).toContain("vào 900");
  });

  it("keeps the decision log to lifecycle milestones, not tool noise", async () => {
    const room = feed([
      { payload: { goal: "A", subagent_id: "sa-0" }, type: "subagent.start" },
      {
        payload: { goal: "A", subagent_id: "sa-0", tool_name: "read_file" },
        type: "subagent.tool",
      },
      {
        payload: { goal: "A", status: "completed", subagent_id: "sa-0" },
        type: "subagent.complete",
      },
    ]);
    await mount({ room });
    await click("Nhật ký quyết định");
    const rows = container.querySelectorAll(".hermes-agent-room-log li");
    expect(rows).toHaveLength(2);
  });
  it("offers a sub-agent's own transcript only when there is one to read", async () => {
    // No child_session_id — a tab that could never fill is worse than no tab.
    await mount({ onLoadChildTranscript: async () => [] });
    expect(text()).not.toContain("Hội thoại riêng");
  });

  it("opens the sub-agent's own session on demand, not on render", async () => {
    const onLoadChildTranscript = vi.fn<
      (sessionId: string) => Promise<Array<{ role: string; content: string | null }>>
    >(async () => [
      { content: "Nói đúng một dòng: Hermes ok", role: "user" },
      { content: '{"text": "Hermes ok"}', role: "assistant" },
    ]);
    const room = feed([
      {
        payload: {
          child_session_id: "20260902_081054_bd283c",
          goal: "Nhiệm vụ Alpha",
          subagent_id: "sa-0",
        },
        type: "subagent.start",
      },
    ]);
    await mount({ onLoadChildTranscript, room });

    // A child session is only readable once its agent is selected.
    const card = container.querySelector(".hermes-agent-card") as HTMLButtonElement;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onLoadChildTranscript).not.toHaveBeenCalled();

    await click("Hội thoại riêng");
    expect(onLoadChildTranscript).toHaveBeenCalledWith("20260902_081054_bd283c");
    expect(text()).toContain("Việc được giao");
    expect(text()).toContain('{"text": "Hermes ok"}');
  });

  it("says so when a child session cannot be read", async () => {
    const room = feed([
      {
        payload: {
          child_session_id: "child-1",
          goal: "Nhiệm vụ Alpha",
          subagent_id: "sa-0",
        },
        type: "subagent.start",
      },
    ]);
    await mount({
      onLoadChildTranscript: async () => {
        throw new Error("404");
      },
      room,
    });
    const card = container.querySelector(".hermes-agent-card") as HTMLButtonElement;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await click("Hội thoại riêng");
    expect(text()).toContain("Không đọc được phiên riêng");
  });
});
