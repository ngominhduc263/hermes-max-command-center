// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end cover for the live turn: does the chat actually poll the gateway
 * replay ring, and does a raw `session.events.since` frame reach the bubble?
 *
 * Written after three rounds of shipping this blind — the reducer had unit
 * tests, but nothing checked that the component wires the poller to it.
 */

const apiMocks = vi.hoisted(() => ({
  authedFetch: vi.fn(async () => new Response("{}")),
  buildWsUrl: vi.fn(async () => "ws://localhost/api/events?channel=chat-1"),
  getSessionMessages: vi.fn(async () => ({
    messages: [{ content: "chào em", role: "user" as const }],
    session_id: "s-1",
  })),
  getConfig: vi.fn(async (): Promise<Record<string, unknown>> => ({
    compression: { threshold: 0.5 },
  })),
  getSessions: vi.fn(async () => ({ sessions: [] })),
  getSkills: vi.fn(async () => []),
}));

interface ReplayResponse {
  events: unknown[];
  latest_seq: number;
}

const gatewayMocks = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(async () => undefined),
  request: vi.fn(
    async (...args: unknown[]): Promise<{
      events: unknown[];
      latest_seq: number;
    }> => {
      void args;
      return { events: [], latest_seq: 0 };
    },
  ),
  state: "open",
}));

vi.mock("@/lib/api", () => ({
  api: {
    getConfig: apiMocks.getConfig,
    getSessionMessages: apiMocks.getSessionMessages,
    getSessions: apiMocks.getSessions,
    getSkills: apiMocks.getSkills,
  },
  authedFetch: apiMocks.authedFetch,
  buildWsUrl: apiMocks.buildWsUrl,
}));
vi.mock("@/lib/gatewayClient", () => ({
  GatewayClient: class {
    close = gatewayMocks.close;
    connect = gatewayMocks.connect;
    request = gatewayMocks.request;
    get connectionState() {
      return gatewayMocks.state;
    }
  },
}));
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@nous-research/ui/ui/components/button", () => ({
  Button: ({ children, ...rest }: { children?: ReactNode }) => (
    <button {...rest}>{children}</button>
  ),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {}
}

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

/** Let the poller's timers and promises run `times` rounds. */
async function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  }
}

/**
 * The gateway keys a session twice: `id` (what events are stamped with) and
 * `session_key` (what the URL and the store use). The fake mirrors that so the
 * lookup is exercised rather than assumed.
 */
function stubGateway(options: {
  rows?: Array<{ id: string; session_key?: string; current?: boolean }>;
  replies?: ReplayResponse[];
  catalog?: unknown;
  pending?: unknown[];
  usage?: unknown;
  delegation?: unknown;
  clarify?: unknown;
  pet?: unknown;
}) {
  const rows = options.rows ?? [{ id: "gw-9", session_key: "s-1" }];
  const replies = [...(options.replies ?? [])];
  gatewayMocks.request.mockImplementation(async (...args: unknown[]) => {
    const [method] = args as [string, Record<string, unknown>?];
    if (method === "session.active_list") return { sessions: rows } as never;
    // The palette asks for this once per PTY session; it must not consume a
    // reply meant for the replay ring.
    if (method === "commands.catalog") return (options.catalog ?? {}) as never;
    if (method === "approval.pending") {
      return { approvals: options.pending ?? [] } as never;
    }
    if (method === "approval.respond") return { resolved: 1 } as never;
    // The context gauge seeds itself from this once per gateway session. Like
    // the catalog above, it must not eat a reply meant for the replay ring.
    if (method === "session.usage") return (options.usage ?? {}) as never;
    if (method === "session.context_breakdown") return { categories: [] } as never;
    // Seeded once per gateway connection by the agent room. Like the catalog,
    // it must not consume a reply meant for the replay ring.
    if (method === "delegation.status") {
      return (options.delegation ?? { active: [], paused: false }) as never;
    }
    if (method === "subagent.interrupt") return { found: true } as never;
    if (method === "clarify.respond") {
      return (options.clarify ?? { remaining: [], status: "ok" }) as never;
    }
    // The pet asks for these on mount. Same rule as every RPC above: a panel's
    // own request must never consume a reply meant for the replay ring.
    if (method === "pet.info.meta" || method === "pet.info") {
      return (options.pet ?? { enabled: false }) as never;
    }
    if (method === "pet.gallery") {
      return { active: "", enabled: false, pets: [] } as never;
    }
    // The checkpoints panel, likewise — only mounted when its drawer is open,
    // but a stray call must still not be answered from the ring.
    if (method === "rollback.list") {
      return { checkpoints: [], enabled: false } as never;
    }
    return (replies.shift() ??
      replies.at(-1) ?? { events: [], latest_seq: 1 }) as never;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  gatewayMocks.request.mockClear();
  gatewayMocks.connect.mockClear();
  gatewayMocks.request.mockReset();
  stubGateway({});
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // jsdom ships no layout engine, so it has no scrollIntoView — the palette
  // calls it whenever the highlighted row moves.
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(
  props: {
    syncTerminal?: boolean;
    onAgentRoomChange?: (room: unknown) => void;
  } = {},
) {
  const { CommandChat } = await import("./CommandChat");
  await render(
    <CommandChat
      initialSessionId="s-1"
      profile=""
      enabled
      connectionState="open"
      channel="chat-1"
      onSubmit={async () => null}
      onStop={() => undefined}
      onAttachFiles={async () => []}
      {...props}
    />,
  );
}

/** Drive the composer the way a keypress would, through React's onChange. */
async function typeInComposer(value: string) {
  const textarea = container.querySelector("textarea");
  expect(textarea).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const APPROVAL = {
  choices: ["once", "session", "always", "deny"],
  command: "rm -rf D:/HERMES AGENT/logs",
  description: "recursive delete",
  pattern_key: "recursive delete",
  request_id: "req-1",
};

const STREAMING_REPLIES: ReplayResponse[] = [
  { events: [], latest_seq: 12 },
  {
    events: [
      { seq: 13, session_id: "gw-9", type: "message.start" },
      {
        payload: { text: "Dạ em kể nè anh" },
        seq: 14,
        session_id: "gw-9",
        type: "message.delta",
      },
    ],
    latest_seq: 14,
  },
];

describe("CommandChat live turn", () => {
  it("shows the live-feed state so a silent stream is visible", async () => {
    await mount();
    await tick();
    expect(container.querySelector(".hermes-command-live-state")).not.toBeNull();
  });

  it("asks the ring for the gateway's session id, not the store's", async () => {
    await mount();
    await tick(2);
    const calls = gatewayMocks.request.mock.calls.filter(
      ([method]) => method === "session.events.since",
    );
    expect(calls.length).toBeGreaterThan(0);
    // "s-1" is the store id in the URL; "gw-9" is what the ring is filed under.
    expect(calls[0][1]).toMatchObject({ session_id: "gw-9" });
  });

  it("says so when no live session matches, instead of sitting on 'đã nối'", async () => {
    stubGateway({ rows: [] });
    await mount();
    await tick(2);
    expect(container.textContent).toContain("chưa khớp phiên");
  });

  it("falls back to the session the gateway marks as current", async () => {
    stubGateway({
      rows: [
        { id: "gw-1", session_key: "other" },
        { current: true, id: "gw-2", session_key: "another" },
      ],
    });
    await mount();
    await tick(2);
    const calls = gatewayMocks.request.mock.calls.filter(
      ([method]) => method === "session.events.since",
    );
    expect(calls[0][1]).toMatchObject({ session_id: "gw-2" });
  });

  it("takes a watermark first, then streams the deltas that follow", async () => {
    stubGateway({ replies: STREAMING_REPLIES });
    await mount();
    await tick(3);

    expect(container.textContent).toContain("Dạ em kể nè anh");
    expect(container.textContent).toContain("Đang viết");
  });

  it("holds the text back and waits cutely when syncing is off", async () => {
    stubGateway({ replies: STREAMING_REPLIES });
    await mount({ syncTerminal: false });
    await tick(3);

    // The answer stays hidden until the turn finishes…
    expect(container.textContent).not.toContain("Dạ em kể nè anh");
    // …but the bubble still says it is working, and how far along it is.
    expect(container.textContent).toContain("đã viết 15 chữ");
    const { WAITING_LINES } = await import("@/lib/chat-waiting-lines");
    expect(
      WAITING_LINES.some((line) => container.textContent?.includes(line)),
    ).toBe(true);
  });

  it("also accepts deltas pushed over the events socket", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: { text: "qua socket" },
            seq: 5,
            session_id: "gw-9",
            type: "message.delta",
          },
        }),
      });
    });

    expect(container.textContent).toContain("qua socket");
  });

  it("puts a command only this install has into the `/` palette", async () => {
    stubGateway({
      catalog: {
        categories: [
          {
            name: "Plugin commands",
            pairs: [["/standup", "Post today's standup"]],
          },
        ],
        pairs: [["/standup", "Post today's standup"]],
      },
    });
    await mount();
    await tick(2);

    // "/stand" is not in the baked registry — it can only have come from the
    // catalog RPC.
    await typeInComposer("/stand");
    expect(container.textContent).toContain("/standup");
    expect(container.textContent).toContain("Post today's standup");
  });

  it("keeps the baked palette when the catalog RPC is not there", async () => {
    gatewayMocks.request.mockImplementation(async (...args: unknown[]) => {
      const [method] = args as [string];
      if (method === "commands.catalog") throw new Error("method not found");
      if (method === "session.active_list") {
        return { sessions: [{ id: "gw-9", session_key: "s-1" }] } as never;
      }
      return { events: [], latest_seq: 1 } as never;
    });
    await mount();
    await tick(2);

    await typeInComposer("/mod");
    expect(container.textContent).toContain("/model");
  });

  it("shows the approval in the chat, in Vietnamese, with buttons", async () => {
    // Hermes blocks the agent thread and asks. That prompt is drawn by the
    // Ink TUI, so without this the Chat tab just goes quiet.
    stubGateway({
      replies: [
        { events: [], latest_seq: 20 },
        {
          events: [
            {
              payload: APPROVAL,
              seq: 21,
              session_id: "gw-9",
              type: "approval.request",
            },
          ],
          latest_seq: 21,
        },
      ],
    });
    await mount();
    await tick(3);

    expect(container.textContent).toContain("Hermes xin phép chạy lệnh này");
    expect(container.textContent).toContain("Xoá đệ quy cả thư mục con");
    expect(container.textContent).toContain("rm -rf D:/HERMES AGENT/logs");
    for (const label of [
      "Cho phép một lần",
      "Cho phép phiên này",
      "Luôn cho phép",
      "Từ chối",
    ]) {
      expect(container.textContent, label).toContain(label);
    }
  });

  it("answers by request id and clears the card", async () => {
    stubGateway({
      replies: [
        { events: [], latest_seq: 20 },
        {
          events: [
            {
              payload: APPROVAL,
              seq: 21,
              session_id: "gw-9",
              type: "approval.request",
            },
          ],
          latest_seq: 21,
        },
      ],
    });
    await mount();
    await tick(3);

    const button = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Cho phép một lần"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const responded = gatewayMocks.request.mock.calls.filter(
      ([method]) => method === "approval.respond",
    );
    expect(responded).toHaveLength(1);
    expect(responded[0][1]).toEqual({
      choice: "once",
      request_id: "req-1",
      session_id: "gw-9",
    });
    expect(container.textContent).not.toContain("Hermes xin phép chạy lệnh này");
    expect(container.textContent).toContain("Đã cho phép một lần");
  });

  it("picks up an approval raised before the chat was opened", async () => {
    // No event is coming for it — the agent is simply sitting blocked.
    stubGateway({ pending: [APPROVAL] });
    await mount();
    await tick(3);
    expect(container.textContent).toContain("Hermes xin phép chạy lệnh này");
  });

  it("keeps the card up when the answer could not be sent", async () => {
    stubGateway({ pending: [APPROVAL] });
    await mount();
    await tick(3);
    gatewayMocks.request.mockRejectedValue(new Error("socket closed"));

    const button = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Từ chối"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Hiding the only way to unblock the agent would be the worst outcome.
    expect(container.textContent).toContain("Hermes xin phép chạy lệnh này");
    expect(container.textContent).toContain("socket closed");
    expect(container.textContent).toContain("tab Terminal");
  });

  it("drops the card when the prompt was answered somewhere else", async () => {
    stubGateway({ pending: [APPROVAL] });
    await mount();
    await tick(3);
    expect(container.textContent).toContain("Hermes xin phép chạy lệnh này");

    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: { seq: 99, session_id: "gw-9", type: "approval.resolved" },
        }),
      });
    });
    expect(container.textContent).not.toContain("Hermes xin phép chạy lệnh này");
  });

  it("reports the reason when the replay RPC fails", async () => {
    gatewayMocks.request.mockReset();
    gatewayMocks.request.mockRejectedValue(new Error("method not found"));
    await mount();
    await tick(2);
    expect(container.textContent).toContain("method not found");
  });

  it("seeds the context gauge from the session, not only from the next turn", async () => {
    // Reopening a chat that has been running for an hour must not read
    // "chưa đo được" until the user happens to send another message.
    stubGateway({
      usage: { context_max: 200_000, context_percent: 39, context_used: 78_000 },
    });
    await mount();
    await tick(3);
    expect(container.textContent).toContain("78k/200k · 39%");
  });

  it("updates the gauge from the usage every finished turn carries", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              status: "complete",
              text: "xong rồi",
              usage: {
                context_max: 200_000,
                context_percent: 71,
                context_used: 142_000,
              },
            },
            seq: 42,
            session_id: "gw-9",
            type: "message.complete",
          },
        }),
      });
    });
    expect(container.textContent).toContain("142k/200k · 71%");
  });

  it("keeps the last reading when a turn ends without one", async () => {
    stubGateway({
      usage: { context_max: 200_000, context_percent: 39, context_used: 78_000 },
    });
    await mount();
    await tick(3);
    const socket = FakeWebSocket.instances.at(-1);

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            // An interrupted turn reports no occupancy at all. Blanking the
            // gauge here would make it flicker to "chưa đo được" and back.
            payload: { status: "interrupted", text: "", usage: { calls: 13 } },
            seq: 43,
            session_id: "gw-9",
            type: "message.complete",
          },
        }),
      });
    });
    expect(container.textContent).toContain("78k/200k · 39%");
  });

  it("says it does not know before the session has been measured", async () => {
    stubGateway({ usage: {} });
    await mount();
    await tick(3);
    expect(container.textContent).toContain("Ngữ cảnh: chưa đo được");
  });

  it("shows nothing about agents when Hermes is not delegating", async () => {
    await mount();
    await tick(3);
    expect(container.textContent).not.toContain("Phòng họp Agents");
  });

  it("opens the agent room from live sub-agent events", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              goal: "Rà soát module thanh toán",
              model: "glm-5.3",
              subagent_id: "sa-0",
              task_count: 2,
              task_index: 0,
            },
            seq: 50,
            session_id: "gw-9",
            type: "subagent.start",
          },
        }),
      });
    });

    expect(container.textContent).toContain("Phòng họp Agents");
    expect(container.textContent).toContain("Rà soát module thanh toán");
    expect(container.textContent).toContain("glm-5.3");
  });

  it("recovers agents that were already running before the page opened", async () => {
    // The reload / reconnect path: those agents emit no further spawn event,
    // so without the snapshot the room would be empty over live work.
    stubGateway({
      delegation: {
        active: [
          {
            depth: 0,
            goal: "Việc đang chạy dở",
            model: "glm-5.3",
            started_at: 1_756_000_000,
            status: "running",
            subagent_id: "sa-7",
            tool_count: 5,
          },
        ],
        max_concurrent_children: 3,
        paused: false,
      },
    });
    await mount();
    await tick(3);
    expect(container.textContent).toContain("Việc đang chạy dở");
    expect(container.textContent).toContain("5 lần gọi công cụ");
  });

  it("asks for the delegation snapshot once, not on every poll", async () => {
    // The replay poll runs every 320ms; asking there would be exactly the
    // dense poll the event stream exists to avoid.
    await mount();
    await tick(6);
    const calls = gatewayMocks.request.mock.calls.filter(
      ([method]) => method === "delegation.status",
    );
    expect(calls).toHaveLength(1);
  });

  it("does not double-count an event that arrives live and in the replay", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    const frame = {
      method: "event",
      params: {
        payload: { goal: "Một việc", subagent_id: "sa-0" },
        seq: 60,
        session_id: "gw-9",
        type: "subagent.start",
      },
    };
    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify(frame) });
      socket?.onmessage?.({ data: JSON.stringify(frame) });
    });
    // One agent, and the seq guard keeps the second copy out of the stream.
    const cards = container.querySelectorAll(".hermes-agent-card");
    expect(cards).toHaveLength(1);
    expect(
      container.querySelectorAll(".hermes-agent-room-stream li"),
    ).toHaveLength(1);
  });

  it("marks an agent finished from its completion event", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: { goal: "Một việc", subagent_id: "sa-0" },
            seq: 70,
            session_id: "gw-9",
            type: "subagent.start",
          },
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              duration_seconds: 8,
              goal: "Một việc",
              status: "completed",
              subagent_id: "sa-0",
              summary: "Đã xong",
            },
            seq: 71,
            session_id: "gw-9",
            type: "subagent.complete",
          },
        }),
      });
    });
    expect(container.textContent).toContain("Hoàn thành");
    expect(container.textContent).toContain("Đã xong");
  });

  it("keeps sub-agent events out of the main chat transcript", async () => {
    // The agents' work is not Hermes's reply to the user; mixing them would
    // put tool chatter into the conversation.
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              goal: "Việc phụ",
              subagent_id: "sa-0",
              text: "nội dung nội bộ của agent",
            },
            seq: 80,
            session_id: "gw-9",
            type: "subagent.thinking",
          },
        }),
      });
    });
    const viewport = container.querySelector(
      ".hermes-command-conversation-viewport",
    );
    expect(viewport?.textContent).not.toContain("nội dung nội bộ của agent");
  });
  it("does not re-render the page on every single sub-agent event", async () => {
    // v2.23.0 pushed the room into page state on every frame. A busy child
    // emits `thinking`/`tool` continuously, so that was hundreds of full
    // ChatPage renders a minute — and ChatPage hosts the sidebar that owns its
    // own gateway connection and sidecar session.
    const onAgentRoomChange = vi.fn();
    await mount({ onAgentRoomChange });
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    const before = onAgentRoomChange.mock.calls.length;

    await act(async () => {
      for (let index = 0; index < 40; index += 1) {
        socket?.onmessage?.({
          data: JSON.stringify({
            method: "event",
            params: {
              payload: { goal: "Việc", subagent_id: "sa-0", tool_name: `t${index}` },
              seq: 200 + index,
              session_id: "gw-9",
              type: "subagent.tool",
            },
          }),
        });
      }
    });

    // Forty frames must not become forty page updates.
    expect(onAgentRoomChange.mock.calls.length - before).toBeLessThan(3);
    // The panel itself still shows them all, unthrottled.
    expect(
      container.querySelectorAll(".hermes-agent-room-stream li").length,
    ).toBeGreaterThan(30);
  });
  it("shows the clarify form Hermes is blocked on", async () => {
    // Without this the chat just stops mid-answer: `clarify` blocks the whole
    // turn and the terminal was the only place the question appeared.
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              questions: [
                {
                  choices: ["1 Code + 1 Research (Recommended)", "Other"],
                  multi_select: false,
                  qid: "q1",
                  question: "Đặt vai cho 2 em thế nào?",
                },
                { choices: [], qid: "q2", question: "Tên 2 em thì sao?" },
              ],
              request_id: "req-1",
            },
            seq: 300,
            session_id: "gw-9",
            type: "clarify.request",
          },
        }),
      });
    });

    expect(container.textContent).toContain("Hermes hỏi lại 2 câu");
    expect(container.textContent).toContain("Đặt vai cho 2 em thế nào?");
    // The "(Recommended)" suffix becomes a badge, not part of the label.
    expect(container.textContent).toContain("Hermes gợi ý");
    expect(container.textContent).toContain("1 Code + 1 Research");
  });

  it("answers one question at a time, naming it by qid", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              questions: [
                { choices: ["A", "B"], qid: "q1", question: "Chọn gì?" },
                { choices: [], qid: "q2", question: "Tên?" },
              ],
              request_id: "req-1",
            },
            seq: 310,
            session_id: "gw-9",
            type: "clarify.request",
          },
        }),
      });
    });

    const choice = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "A",
    );
    await act(async () => {
      choice?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Chốt câu này"),
    );
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const call = gatewayMocks.request.mock.calls.find(
      ([method]) => method === "clarify.respond",
    );
    expect(call?.[1]).toMatchObject({
      answer: "A",
      question_id: "q1",
      request_id: "req-1",
    });
    // The default stub reports nothing remaining, which is what releases the
    // tool — so the form closes.
    expect(container.textContent).not.toContain("Hermes hỏi lại");
  });

  it("keeps the form open until the server says nothing remains", async () => {
    stubGateway({ clarify: { remaining: ["q2"], status: "ok" } });
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: {
              questions: [
                { choices: ["A"], qid: "q1", question: "Một" },
                { choices: ["B"], qid: "q2", question: "Hai" },
              ],
              request_id: "req-1",
            },
            seq: 320,
            session_id: "gw-9",
            type: "clarify.request",
          },
        }),
      });
    });
    const pick = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "A",
    );
    await act(async () => {
      pick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Chốt câu này"),
    );
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Hai");
  });

  it("drops the form when the clarify times out server-side", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: { choices: ["A"], question: "Chọn?", request_id: "req-1" },
            seq: 330,
            session_id: "gw-9",
            type: "clarify.request",
          },
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: { request_id: "req-1" },
            seq: 331,
            session_id: "gw-9",
            type: "clarify.expire",
          },
        }),
      });
    });
    expect(container.textContent).not.toContain("Hermes hỏi lại");
  });

  it("keeps clarify text out of the main transcript", async () => {
    await mount();
    await tick();
    const socket = FakeWebSocket.instances.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          method: "event",
          params: {
            payload: { choices: [], question: "câu hỏi nội bộ", request_id: "r" },
            seq: 340,
            session_id: "gw-9",
            type: "clarify.request",
          },
        }),
      });
    });
    const viewport = container.querySelector(
      ".hermes-command-conversation-viewport",
    );
    expect(viewport?.textContent).not.toContain("câu hỏi nội bộ");
  });
});
