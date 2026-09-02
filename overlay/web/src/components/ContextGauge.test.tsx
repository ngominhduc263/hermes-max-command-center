// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gauge exists to answer "how full is the context", so the tests pin the
 * two ways it could answer wrongly: showing a number Hermes never measured
 * (the #50421 class of bug — a confident 0% or a lifetime total passed off as
 * window occupancy), and claiming to know a compaction trigger that is
 * resolved inside the agent and exposed over no RPC.
 */

vi.mock("@nous-research/ui/ui/components/button", () => ({
  Button: ({ children, ...rest }: { children?: ReactNode }) => (
    <button {...rest}>{children}</button>
  ),
}));

import { EMPTY_CONTEXT_USAGE, parseContextUsage } from "@/lib/chat-context-usage";

const measured = parseContextUsage({
  calls: 12,
  compressions: 2,
  context_max: 200_000,
  context_percent: 39,
  context_used: 78_000,
  model: "claude-sonnet-4",
  total: 82_000,
});

const breakdown = {
  categories: [
    { color: "#aaa", id: "conversation", label: "Conversation", tokens: 50_000 },
    { color: "#bbb", id: "system_prompt", label: "System prompt", tokens: 9_000 },
  ],
  context_max: 200_000,
  context_used: 78_000,
  estimated_total: 59_000,
};

let container: HTMLDivElement;
let root: Root;

type Props = {
  usage?: ReturnType<typeof parseContextUsage>;
  onBreakdown?: () => Promise<unknown>;
  config?: unknown;
};

async function mount(props: Props = {}) {
  const { ContextGauge } = await import("./ContextGauge");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ContextGauge
        usage={props.usage ?? measured}
        onBreakdown={props.onBreakdown}
        config={props.config}
      />,
    ),
  );
}

const text = () => container.textContent ?? "";
const trigger = () =>
  container.querySelector(".hermes-context-gauge-trigger") as HTMLElement;

async function openPanel() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ContextGauge", () => {
  it("shows the reading the gateway measured", async () => {
    await mount();
    expect(text()).toContain("78k/200k · 39%");
  });

  it("says it does not know rather than showing 0%", async () => {
    // A session before its first turn has no occupancy figure, and Hermes
    // withholds the gauge on purpose for engines that cannot report one.
    await mount({ usage: EMPTY_CONTEXT_USAGE });
    expect(text()).toContain("chưa đo được");
    expect(text()).not.toContain("0%");
  });

  it("colours the trigger by how full the window is", async () => {
    await mount();
    expect(trigger().className).toContain("is-roomy");
    await act(async () => root.unmount());
    container.remove();

    await mount({
      usage: parseContextUsage({
        context_max: 200_000,
        context_percent: 92,
        context_used: 184_000,
      }),
    });
    expect(trigger().className).toContain("is-full");
  });

  it("opens the detail panel and names Hermes's own command", async () => {
    await mount();
    await openPanel();
    // The whole reason this was asked for: the user knows /compact elsewhere.
    expect(text()).toContain("/compress");
    expect(text()).toContain("/context");
  });

  it("reports how many times Hermes already compressed by itself", async () => {
    await mount();
    await openPanel();
    expect(text()).toContain("đã tự nén 2 lần");
  });

  it("asks for the breakdown only when the panel opens", async () => {
    const onBreakdown = vi.fn(async (): Promise<unknown> => breakdown);
    await mount({ onBreakdown });
    // The gateway rebuilds the system prompt and walks the whole history to
    // answer it, so it must never run on render or on a poll.
    expect(onBreakdown).not.toHaveBeenCalled();

    await openPanel();
    expect(onBreakdown).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Hội thoại");
  });

  it("does not re-ask on every reopen", async () => {
    const onBreakdown = vi.fn(async (): Promise<unknown> => breakdown);
    await mount({ onBreakdown });
    await openPanel();
    await openPanel();
    await openPanel();
    expect(onBreakdown).toHaveBeenCalledTimes(1);
  });

  it("keeps the gauge when the breakdown request fails", async () => {
    const onBreakdown = vi.fn(
      async (): Promise<unknown> => Promise.reject(new Error("gateway busy")),
    );
    await mount({ onBreakdown });
    await openPanel();
    // The measured reading is still right; only the detail table is missing.
    expect(text()).toContain("78k/200k · 39%");
    expect(text()).toContain("/compress");
  });

  it("warns that the per-category figures are estimates", async () => {
    await mount({ onBreakdown: async (): Promise<unknown> => breakdown });
    await openPanel();
    expect(text()).toContain("ước lượng");
  });

  it("labels the configured threshold as configured, not as the real trigger", async () => {
    await mount({ config: { compression: { threshold: 0.5 } } });
    await openPanel();
    expect(text()).toContain("Ngưỡng nén trong cấu hình: 50%");
    expect(text()).toContain("nâng cao hơn");
  });

  it("shows no threshold line when the config did not say", async () => {
    await mount();
    await openPanel();
    expect(text()).not.toContain("Ngưỡng nén trong cấu hình");
  });

  it("closes on Escape", async () => {
    await mount();
    await openPanel();
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});
