// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The panel's whole job is undoing a permission the user cannot otherwise take
 * back, so these tests pin the two things that would make it dangerous: that a
 * revoke sends the remaining list (never a blank one), and that a partial patch
 * never carries keys it wasn't asked to change — `PUT /api/config` deep-merges
 * and replaces lists wholesale, so an over-broad body would silently wipe
 * config the user never touched.
 */

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      approvals: { deny: ["shutdown *"], mode: "smart" },
      command_allowlist: ["recursive delete", "SQL DROP"],
    }),
  ),
  // Typed params so the assertions below can read the patch body; an
  // untyped vi.fn() infers a zero-arg call signature.
  saveConfig: vi.fn(
    async (config: Record<string, unknown>, profile?: string) => {
      void config;
      void profile;
      return { ok: true };
    },
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

/**
 * Click by label. Exact matches win, so "Thu hồi" picks a row's own button
 * rather than "Thu hồi tất cả"; substring matching is the fallback for
 * buttons that also render a description (the mode picker).
 */
async function click(text: string, index = 0) {
  const buttons = [...container.querySelectorAll("button")];
  const exact = buttons.filter((button) => button.textContent?.trim() === text);
  const targets = exact.length
    ? exact
    : buttons.filter((button) => button.textContent?.includes(text));
  expect(targets[index], `no button #${index} matching "${text}"`).toBeDefined();
  await act(async () => {
    targets[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

async function mount(props: { onSaved?: () => void; onClose?: () => void } = {}) {
  const { PermissionsPanel } = await import("./PermissionsPanel");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <PermissionsPanel
        profile=""
        onClose={props.onClose ?? (() => undefined)}
        onSaved={props.onSaved}
      />,
    ),
  );
}

/** The body of the Nth saveConfig call. */
const patchAt = (index = 0) =>
  apiMocks.saveConfig.mock.calls[index]?.[0];

beforeEach(() => {
  apiMocks.getConfig.mockClear();
  apiMocks.saveConfig.mockClear();
  apiMocks.getConfig.mockResolvedValue({
    approvals: { deny: ["shutdown *"], mode: "smart" },
    command_allowlist: ["recursive delete", "SQL DROP"],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PermissionsPanel", () => {
  it("explains each granted permission in Vietnamese, worst first", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Xoá đệ quy cả thư mục con");
    expect(text).toContain("Xoá hẳn bảng hoặc cả cơ sở dữ liệu");
    // The raw key stays visible so it can be matched against config.yaml.
    expect(text).toContain("recursive delete");
    expect(text.indexOf("Xoá đệ quy")).toBeLessThan(text.indexOf("Xoá hẳn bảng"));
  });

  it("asks before revoking, and does not write until confirmed", async () => {
    await mount();
    await click("Thu hồi");
    expect(apiMocks.saveConfig).not.toHaveBeenCalled();

    await click("Thôi");
    expect(apiMocks.saveConfig).not.toHaveBeenCalled();
  });

  it("revokes one permission by sending the rest, not an empty list", async () => {
    await mount();
    // First click arms the first row; the confirm button replaces it in
    // place, so the second click at the same position is the confirmation.
    await click("Thu hồi");
    await click("Thu hồi");

    expect(patchAt()).toEqual({ command_allowlist: ["SQL DROP"] });
    // Nothing else may ride along: the endpoint replaces lists wholesale.
    expect(Object.keys(patchAt())).toEqual(["command_allowlist"]);
  });

  it("revokes everything with an explicit empty list", async () => {
    await mount();
    await click("Thu hồi tất cả");
    expect(patchAt()).toEqual({ command_allowlist: [] });
  });

  it("re-reads config after saving instead of trusting its own copy", async () => {
    await mount();
    expect(apiMocks.getConfig).toHaveBeenCalledTimes(1);
    apiMocks.getConfig.mockResolvedValue({ command_allowlist: [] });

    await click("Thu hồi tất cả");
    expect(apiMocks.getConfig).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Chưa cấp quyền vĩnh viễn nào");
  });

  it("changes the approval mode on its own, touching no other key", async () => {
    await mount();
    await click("Hỏi mọi lúc");
    expect(patchAt()).toEqual({ approvals: { mode: "manual" } });
  });

  it("warns loudly while approvals are switched off", async () => {
    apiMocks.getConfig.mockResolvedValue({ approvals: { mode: "off" } });
    await mount();
    expect(container.textContent).toContain("Đang tắt hỏi duyệt");
  });

  it("adds a block rule alongside the ones already there", async () => {
    await mount();
    await type("rm -rf *");
    await click("Chặn");
    expect(patchAt()).toEqual({
      approvals: { deny: ["shutdown *", "rm -rf *"] },
    });
  });

  it("nudges when a block rule has no wildcard", async () => {
    await mount();
    await type("rm -rf");
    expect(container.textContent).toContain("Thêm dấu *");
  });

  it("removes a block rule", async () => {
    await mount();
    const remove = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Bỏ luật chặn shutdown *",
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(patchAt()).toEqual({ approvals: { deny: [] } });
  });

  it("reports a failed save rather than pretending it worked", async () => {
    apiMocks.saveConfig.mockRejectedValueOnce(new Error("403 forbidden"));
    const onSaved = vi.fn();
    await mount({ onSaved });

    await click("Thu hồi tất cả");
    expect(container.textContent).toContain("403 forbidden");
    expect(onSaved).not.toHaveBeenCalled();
    // The grant is still on screen, because the panel never assumed it went.
    expect(container.textContent).toContain("Xoá đệ quy cả thư mục con");
  });

  it("offers a retry when the config cannot be read at all", async () => {
    apiMocks.getConfig.mockRejectedValueOnce(new Error("gateway down"));
    await mount();
    expect(container.textContent).toContain("gateway down");

    apiMocks.getConfig.mockResolvedValue({ command_allowlist: ["SQL DROP"] });
    await click("Thử lại");
    expect(container.textContent).toContain("Xoá hẳn bảng");
  });

  it("tells the caller to refresh once a save lands", async () => {
    const onSaved = vi.fn();
    await mount({ onSaved });
    await click("Thu hồi tất cả");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
