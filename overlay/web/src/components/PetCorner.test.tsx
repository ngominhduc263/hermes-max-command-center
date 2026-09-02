// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PetCorner } from "./PetCorner";

/**
 * The pet is cosmetic, so the risks here are not about correctness of an
 * answer — they are about wasting the user's bandwidth and telling them things
 * Hermes does not know. Two things are pinned: the multi-megabyte spritesheet
 * is not re-fetched when its revision has not moved, and the panel never
 * claims a stat the pet does not have.
 */

const META = {
  displayName: "Mèo",
  enabled: true,
  scale: 0.5,
  slug: "meo",
  spritesheetRevision: "17:900",
};

const SHEET = {
  ...META,
  frameH: 208,
  framesByState: { idle: 6 },
  framesPerState: 6,
  frameW: 192,
  loopMs: 1100,
  mime: "image/webp",
  spritesheetBase64: "AAAA",
  stateRows: ["idle", "wave", "run", "failed", "review", "jump"],
};

let container: HTMLDivElement;
let root: Root;
let call: ReturnType<typeof makeCall>;

function makeCall(overrides: Record<string, unknown> = {}) {
  // Both parameters are declared even though the body only branches on the
  // first: the assertions below read `params`, and an inferred one-arg
  // signature makes that a type error rather than a test failure.
  return vi.fn(async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    void params;
    if (method in overrides) return overrides[method];
    if (method === "pet.info.meta") return META;
    if (method === "pet.info") return SHEET;
    if (method === "pet.gallery") {
      return {
        active: "meo",
        enabled: true,
        pets: [
          { displayName: "Mèo", installed: true, slug: "meo", spritesheetUrl: "u" },
          { displayName: "Cún", installed: true, slug: "cun", spritesheetUrl: "u" },
        ],
      };
    }
    return {};
  });
}

async function mount(activity = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PetCorner
        call={call as never}
        activity={activity}
      />,
    );
  });
  // The loader is deferred one microtask so the effect body stays render-free.
  await act(async () => {});
  await act(async () => {});
}

const click = async (node: Element | null | undefined) => {
  await act(async () => {
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

beforeEach(() => {
  document.body.innerHTML = "";
  call = makeCall();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PetCorner", () => {
  it("draws the sprite once the sheet arrives", async () => {
    await mount();
    const sprite = container.querySelector(".hermes-pet-sprite") as HTMLElement;
    expect(sprite).toBeTruthy();
    expect(sprite.style.backgroundImage).toContain("data:image/webp;base64,AAAA");
  });

  it("sends the revision it holds, so the atlas is not re-downloaded", async () => {
    // pet.info answers `spritesheetUnchanged` when the revision matches. On a
    // first load there is nothing to claim yet, so it sends an empty one.
    await mount();
    const infoCall = call.mock.calls.find(([method]) => method === "pet.info");
    expect(infoCall).toBeDefined();
    expect(infoCall?.[1]?.knownRevision).toBe("");
  });

  it("renders nothing at all when the pet is off", async () => {
    // display.pet.enabled defaults to false, so this is the common case.
    call = makeCall({ "pet.info.meta": { enabled: false } });
    await mount();
    expect(container.querySelector(".hermes-pet-sprite")).toBeNull();
  });

  it("shows the pose the chat activity implies, not a mood", async () => {
    await mount({ toolRunning: true });
    const stage = container.querySelector(".hermes-pet-stage");
    expect(stage?.getAttribute("title")).toContain("đang chạy việc");
  });

  it("says plainly that the pet has no hunger, level or mood", async () => {
    // Hermes stores none of those. A panel that implied otherwise would be
    // inventing a game that does not exist.
    await mount();
    await click(container.querySelector(".hermes-pet-stage"));
    const note = container.querySelector(".hermes-pet-note")?.textContent ?? "";
    expect(note).toContain("không có mức đói");
    expect(note).toContain("cấp độ");
  });

  it("switches pet through pet.select and re-reads the sheet", async () => {
    await mount();
    await click(container.querySelector(".hermes-pet-stage"));
    const cun = [...container.querySelectorAll(".hermes-pet-list button")].find((b) =>
      b.textContent?.includes("Cún"),
    );
    await click(cun);
    expect(call).toHaveBeenCalledWith("pet.select", { slug: "cun" });
  });
});
