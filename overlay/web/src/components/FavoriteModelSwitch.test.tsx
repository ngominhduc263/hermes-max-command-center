// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The quick switcher has to do two things per click, and the second one is the
 * part that broke first: `/model <id>` moves the running session, but only
 * `/api/model/set` moves what the control panel's model badge reads. These
 * tests pin both writes, their order, and what happens when either declines.
 */

const apiMocks = vi.hoisted(() => ({
  getModelInfo: vi.fn(async () => ({ model: "openai/gpt-5", provider: "openai" })),
  getModelOptions: vi.fn(async () => ({
    providers: [
      { models: ["gpt-5"], name: "OpenAI", slug: "openai" },
      { models: ["z-ai/glm-5.3-flash"], name: "OpenRouter", slug: "openrouter" },
    ],
  })),
  setModelAssignment: vi.fn(
    async (): Promise<{
      ok: boolean;
      confirm_required?: boolean;
      confirm_message?: string;
    }> => ({ ok: true }),
  ),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));
vi.mock("@nous-research/ui/ui/components/button", () => ({
  Button: ({ children, ...rest }: { children?: ReactNode }) => (
    <button {...rest}>{children}</button>
  ),
}));

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

/** Click by visible text — the panel has no test ids and should not need any. */
async function click(text: string) {
  const target = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  expect(target, `no button matching "${text}"`).toBeDefined();
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function type(value: string) {
  const input = container.querySelector("input");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mount(props: {
  onSwitch?: (model: string) => Promise<boolean>;
  onModelChanged?: () => void;
} = {}) {
  const { FavoriteModelSwitch } = await import("./FavoriteModelSwitch");
  await render(
    <FavoriteModelSwitch
      onSwitch={props.onSwitch ?? (async () => true)}
      onModelChanged={props.onModelChanged}
      profile=""
    />,
  );
}

/** Open the panel and put one favourite in it, from the options list. */
async function mountWithFavorite(props: Parameters<typeof mount>[0] = {}) {
  await mount(props);
  await click("Model");
  await type("glm");
  await click("Thêm");
}

beforeEach(() => {
  window.localStorage.clear();
  apiMocks.getModelInfo.mockClear();
  apiMocks.getModelOptions.mockClear();
  apiMocks.setModelAssignment.mockReset();
  apiMocks.setModelAssignment.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("FavoriteModelSwitch", () => {
  it("shows the model the session is on", async () => {
    await mount();
    expect(container.textContent).toContain("gpt-5");
  });

  it("adds the real model when the box was used to search", async () => {
    // The box doubles as a search field: "glm" must not become a favourite.
    await mountWithFavorite();
    expect(container.textContent).toContain("z-ai/glm-5.3-flash");
    expect(window.localStorage.getItem("hermes-max-favorite-models")).toContain(
      '"provider":"openrouter"',
    );
  });

  it("still takes a model the options list has never heard of", async () => {
    await mount();
    await click("Model");
    await type("my-lab/experiment-7");
    await click("Thêm");
    expect(container.textContent).toContain("my-lab/experiment-7");
  });

  it("remembers a model across mounts", async () => {
    await mountWithFavorite();
    expect(window.localStorage.getItem("hermes-max-favorite-models")).toContain(
      "glm-5.3-flash",
    );

    await act(async () => root.unmount());
    container.remove();
    await mount();
    await click("Model");
    expect(container.textContent).toContain("glm-5.3-flash");
  });

  it("writes config with the model's own provider, then switches the session", async () => {
    const order: string[] = [];
    apiMocks.setModelAssignment.mockImplementation(async () => {
      order.push("config");
      return { ok: true };
    });
    const onSwitch = vi.fn(async () => {
      order.push("pty");
      return true;
    });

    await mountWithFavorite({ onSwitch });
    await click("glm-5.3-flash");

    expect(apiMocks.setModelAssignment).toHaveBeenCalledWith(
      {
        confirm_expensive_model: false,
        model: "z-ai/glm-5.3-flash",
        provider: "openrouter",
        scope: "main",
      },
      "",
    );
    expect(onSwitch).toHaveBeenCalledWith("z-ai/glm-5.3-flash");
    // Config first: it is where the expensive-model warning lives, and the
    // user must see that before anything actually moves.
    expect(order).toEqual(["config", "pty"]);
  });

  it("tells the page to re-read the model badge", async () => {
    const onModelChanged = vi.fn();
    await mountWithFavorite({ onModelChanged });
    await click("glm-5.3-flash");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });

  it("switches the live session anyway when the config write fails", async () => {
    apiMocks.setModelAssignment.mockRejectedValue(new Error("403"));
    const onSwitch = vi.fn(async () => true);
    const onModelChanged = vi.fn();

    await mountWithFavorite({ onModelChanged, onSwitch });
    await click("glm-5.3-flash");

    expect(onSwitch).toHaveBeenCalledWith("z-ai/glm-5.3-flash");
    // …but it does not claim the panel followed, and does not nudge it.
    expect(onModelChanged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("bảng điều khiển vẫn hiện model cũ");
  });

  it("holds the switch back until an expensive model is confirmed", async () => {
    apiMocks.setModelAssignment.mockResolvedValueOnce({
      confirm_message: "Model này tính phí cao.",
      confirm_required: true,
      ok: false,
    });
    const onSwitch = vi.fn(async () => true);

    await mountWithFavorite({ onSwitch });
    await click("glm-5.3-flash");

    expect(onSwitch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Model này tính phí cao.");

    await click("Vẫn đổi");
    expect(apiMocks.setModelAssignment).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirm_expensive_model: true }),
      "",
    );
    expect(onSwitch).toHaveBeenCalledWith("z-ai/glm-5.3-flash");
  });

  it("drops the switch when the warning is declined", async () => {
    apiMocks.setModelAssignment.mockResolvedValueOnce({
      confirm_message: "Đắt lắm nha.",
      confirm_required: true,
      ok: false,
    });
    const onSwitch = vi.fn(async () => true);

    await mountWithFavorite({ onSwitch });
    await click("glm-5.3-flash");
    await click("Thôi");

    expect(onSwitch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Đã huỷ");
  });

  it("says so when the session refuses the switch", async () => {
    await mountWithFavorite({ onSwitch: async () => false });
    await click("glm-5.3-flash");
    expect(container.textContent).toContain("kiểm tra kết nối Terminal");
  });

  it("falls back to the session's provider for a hand-typed model", async () => {
    await mount();
    await click("Model");
    await type("some-local/model-x");
    await click("Thêm");
    await click("model-x");

    expect(apiMocks.setModelAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "some-local/model-x",
        provider: "openai",
      }),
      "",
    );
  });

  it("removes a model from the list", async () => {
    await mountWithFavorite();
    expect(container.textContent).toContain("glm-5.3-flash");

    const remove = container.querySelector<HTMLButtonElement>(
      ".hermes-model-switch-remove",
    );
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".hermes-model-switch-list")).toBeNull();
    expect(window.localStorage.getItem("hermes-max-favorite-models")).toBe("[]");
  });
});
