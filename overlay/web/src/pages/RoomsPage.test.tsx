// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two rules pinned here.
 *
 * v2.25.0 disabled the create button whenever the room name was empty and said
 * nothing about it, so the form looked broken — a refusal must be explained.
 *
 * v2.27.0 split the page into three columns and made the room list collapsible,
 * which is the feature that gives the conversation its width. A toggle that
 * forgets its state on every visit would be worse than no toggle, so the
 * persistence is pinned too.
 */

const apiMocks = vi.hoisted(() => ({
  getModelOptions: vi.fn(async () => ({
    providers: [
      { name: "Z.ai", slug: "z-ai", models: ["z-ai/glm-5.3-flash"] },
      { name: "OpenAI", slug: "openai", models: ["openai/gpt-5"] },
    ],
  })),
  getProfiles: vi.fn(async () => ({
    profiles: [
      { name: "default" },
      { name: "teo", model: "openai/gpt-5" },
      { name: "ti" },
    ] as unknown as Array<{ name: string }>,
  })),
  setProfileModel: vi.fn(async () => ({
    ok: true,
    provider: "z-ai",
    model: "z-ai/glm-5.3-flash",
  })),
}));

/** A room with two members, so the members column has something to draw. */
const ROOM = {
  room_id: "room-1",
  name: "Gia Đình Yumiko",
  updated_at: 1000,
  latest_seq: 3,
  members: [
    { member_id: "default", profile: "default", handle: "default" },
    { member_id: "teo", profile: "teo", handle: "teo" },
  ],
};

const gatewayMocks = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(async () => undefined),
  request: vi.fn(
    async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      void params;
      if (method === "groups.capabilities") {
        return { driver: true, protocol_version: 2, room_link: { enabled: false } };
      }
      if (method === "groups.list") return { rooms: gatewayMocks.rooms };
      if (method === "groups.state") return { driver_status: { running: true } };
      if (method === "groups.log") return { events: [] };
      return {};
    },
  ),
  rooms: [] as unknown[],
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));
vi.mock("@/lib/gatewayClient", () => ({
  GatewayClient: class {
    close = gatewayMocks.close;
    connect = gatewayMocks.connect;
    request = gatewayMocks.request;
    get connectionState() {
      return "open";
    }
  },
}));
vi.mock("@nous-research/ui/ui/components/button", () => ({
  // `prefix` is the icon slot. Pulled out of the spread so it never lands on
  // the DOM node as an unknown attribute.
  Button: ({
    children,
    prefix,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    prefix?: ReactNode;
  }) => {
    void prefix; // the icon slot; never forwarded to the DOM node
    return <button {...rest}>{children}</button>;
  },
}));
vi.mock("@nous-research/ui/ui/components/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@nous-research/ui/ui/components/spinner", () => ({
  Spinner: () => <span>…</span>,
}));

let container: HTMLDivElement;
let root: Root;

async function mountPage() {
  const { default: RoomsPage } = await import("./RoomsPage");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<RoomsPage />));
}

const click = async (node: Element | null | undefined) => {
  await act(async () => {
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

/** The rail's opener, not the dialog's submit — both read "Tạo phòng". */
const openerButton = () =>
  container.querySelector(".hermes-rooms-rail-top button") as
    | HTMLButtonElement
    | undefined;

async function openCreate() {
  await mountPage();
  await click(openerButton());
}

/** The submit button, scoped to the dialog so it cannot match the opener. */
const createButton = () =>
  [...container.querySelectorAll(".hermes-rooms-modal button")].find((b) =>
    /^(Tạo phòng|Đang tạo…)$/.test(b.textContent?.trim() ?? ""),
  ) as HTMLButtonElement | undefined;

async function type(value: string) {
  // Scoped to the dialog's field: the rail now has a search box of its own,
  // and it is the first <input> on the page.
  const input = container.querySelector(
    ".hermes-rooms-field input",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pick(profile: string) {
  const button = [...container.querySelectorAll(".hermes-rooms-pick button")].find(
    (b) => b.textContent?.includes(profile),
  );
  await click(button);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  gatewayMocks.request.mockClear();
  gatewayMocks.rooms = [];
  apiMocks.setProfileModel.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RoomsPage — creating a room", () => {
  it("says the name is missing instead of just refusing to click", async () => {
    await openCreate();
    await pick("default");
    await pick("teo");
    expect(container.textContent).toContain("Chưa đặt tên phòng");
    expect(createButton()?.disabled).toBe(true);
  });

  it("says a lone member is not a discussion", async () => {
    await openCreate();
    await type("Phòng thử");
    await pick("default");
    expect(container.textContent).toContain("ít nhất 2");
    expect(createButton()?.disabled).toBe(true);
  });

  it("enables the button and says so once everything is valid", async () => {
    await openCreate();
    await type("Phòng thử");
    await pick("default");
    await pick("teo");
    expect(container.textContent).toContain("Đủ điều kiện");
    expect(createButton()?.disabled).toBe(false);
  });

  it("creates the room with the roster shape groups.create requires", async () => {
    await openCreate();
    await type("Phòng thử");
    await pick("default");
    await pick("teo");
    await click(createButton());

    const call = gatewayMocks.request.mock.calls.find(
      ([method]) => method === "groups.create",
    );
    expect(call).toBeDefined();
    const params = call?.[1] as unknown as {
      name: string;
      members: unknown[];
      room_id: string;
    };
    expect(params.name).toBe("Phòng thử");
    expect(params.members).toEqual([
      { handle: "default", member_id: "default", profile: "default" },
      { handle: "teo", member_id: "teo", profile: "teo" },
    ]);
    expect(params.room_id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  });

  it("shows the handles members will use before committing", async () => {
    await openCreate();
    await pick("default");
    await pick("teo");
    expect(container.textContent).toContain("@default, @teo");
  });
});

describe("RoomsPage — the collapsible room list", () => {
  const shell = () => container.querySelector(".hermes-rooms-shell");
  const toggle = () => container.querySelector(".hermes-rooms-rail-toggle");

  it("starts open, since a first-time visitor needs to see their rooms", async () => {
    await mountPage();
    expect(shell()?.classList.contains("is-rail-closed")).toBe(false);
  });

  it("collapses to give the conversation the width", async () => {
    await mountPage();
    await click(toggle());
    expect(shell()?.classList.contains("is-rail-closed")).toBe(true);
  });

  it("remembers the choice, so it does not reopen on every visit", async () => {
    await mountPage();
    await click(toggle());
    expect(window.localStorage.getItem("hermes-max-rooms-rail")).toBe("closed");

    // A second visit reads that back rather than starting over.
    await act(async () => root.unmount());
    container.remove();
    await mountPage();
    expect(shell()?.classList.contains("is-rail-closed")).toBe(true);
  });
});

describe("RoomsPage — changing a member's model", () => {
  /** Mount with one room already selected. */
  async function openRoom() {
    gatewayMocks.rooms = [ROOM];
    await mountPage();
    const card = container.querySelector(".hermes-rooms-card");
    await click(card);
  }

  const modelButtons = () =>
    [...container.querySelectorAll(".hermes-rooms-model-button")] as HTMLButtonElement[];

  it("offers a model button for each member", async () => {
    await openRoom();
    expect(modelButtons()).toHaveLength(2);
  });

  it("warns that the change is not room-scoped BEFORE any click lands", async () => {
    // This is the whole point of the panel. Hermes stores no per-room model,
    // so a picker sitting inside a room would otherwise read as a room
    // setting and quietly change that bot everywhere else.
    await openRoom();
    await click(modelButtons()[0]);
    const warning = container.querySelector(".hermes-rooms-model-warn");
    expect(warning?.textContent).toContain("chính profile đó");
    expect(warning?.textContent).toContain("không có model riêng");
    expect(apiMocks.setProfileModel).not.toHaveBeenCalled();
  });

  it("writes the profile's model with both halves the endpoint needs", async () => {
    await openRoom();
    await click(modelButtons()[1]); // @teo
    await act(async () => {});
    const option = [...container.querySelectorAll(".hermes-rooms-model-list button")]
      .find((b) => b.textContent?.includes("z-ai/glm-5.3-flash"));
    await click(option);

    // profile name, provider, model — a bare model id is rejected server-side.
    expect(apiMocks.setProfileModel).toHaveBeenCalledWith(
      "teo",
      "z-ai",
      "z-ai/glm-5.3-flash",
    );
  });

  it("does not claim the swap is already live", async () => {
    // The running turn keeps the old model; the hot-swap happens when this
    // member next speaks. Saying otherwise is a lie the user catches at once.
    await openRoom();
    await click(modelButtons()[1]);
    await act(async () => {});
    const option = [...container.querySelectorAll(".hermes-rooms-model-list button")]
      .find((b) => b.textContent?.includes("z-ai/glm-5.3-flash"));
    await click(option);
    await act(async () => {});
    expect(container.textContent).toContain("lượt nói kế tiếp");
  });
});
