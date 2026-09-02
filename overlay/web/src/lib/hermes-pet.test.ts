import { describe, expect, it } from "vitest";

import {
  activeGallerySlug,
  clampScale,
  derivePose,
  frameDelayMs,
  framePosition,
  framesForPose,
  LEGACY_STATE_ROWS,
  parsePetGallery,
  parsePetMeta,
  parsePetSprite,
  poseLabelVi,
  rowForPose,
  spriteUnchanged,
  type PetSprite,
} from "./hermes-pet";

/**
 * The payloads below are the shapes Hermes actually emits. The failure worth
 * guarding is drawing the wrong row: petdex sheets name their states
 * differently from Hermes's short names, and a missed alias silently renders
 * the idle row for everything, which looks like "the pet is broken".
 */

const SHEET: PetSprite = {
  dataUri: "data:image/webp;base64,AAAA",
  displayName: "Mèo",
  enabled: true,
  frameH: 208,
  framesByState: {},
  framesPerState: 6,
  frameW: 192,
  loopMs: 1100,
  revision: "1:2",
  scale: 0.33,
  slug: "meo",
  stateRows: LEGACY_STATE_ROWS,
};

describe("parsePetMeta", () => {
  it("reads the enabled payload", () => {
    expect(
      parsePetMeta({
        displayName: "Mèo",
        enabled: true,
        scale: 0.33,
        slug: "meo",
        spritesheetRevision: "17:900",
      }),
    ).toEqual({
      displayName: "Mèo",
      enabled: true,
      revision: "17:900",
      scale: 0.33,
      slug: "meo",
    });
  });

  it("treats a disabled pet as off rather than half-present", () => {
    // Hermes fails open to {enabled:false} on any error, so this is the
    // common case, not an edge case.
    expect(parsePetMeta({ enabled: false }).enabled).toBe(false);
    expect(parsePetMeta(null).enabled).toBe(false);
    expect(parsePetMeta({ slug: "meo" }).enabled).toBe(false);
  });
});

describe("parsePetSprite", () => {
  const payload = {
    displayName: "Mèo",
    enabled: true,
    frameH: 208,
    framesByState: { idle: 6, waving: 4 },
    framesPerState: 6,
    frameW: 192,
    loopMs: 1100,
    mime: "image/webp",
    scale: 0.33,
    slug: "meo",
    spritesheetBase64: "AAAA",
    spritesheetRevision: "17:900",
    stateRows: ["idle", "waving", "running"],
  };

  it("builds a usable data URI and geometry", () => {
    const sprite = parsePetSprite(payload)!;
    expect(sprite.dataUri).toBe("data:image/webp;base64,AAAA");
    expect(sprite.frameW).toBe(192);
    expect(sprite.stateRows).toEqual(["idle", "waving", "running"]);
  });

  it("returns null for the unchanged short form, so the caller keeps its sheet", () => {
    // pet.info drops the multi-MB base64 when knownRevision matches. Treating
    // that as "no pet" would blank the widget on every poll.
    const short = { ...payload, spritesheetBase64: undefined };
    expect(parsePetSprite(short)).toBeNull();
    expect(spriteUnchanged({ enabled: true, spritesheetUnchanged: true })).toBe(true);
  });

  it("falls back to the legacy row order when the server named none", () => {
    const sprite = parsePetSprite({ ...payload, stateRows: undefined })!;
    expect(sprite.stateRows).toEqual(LEGACY_STATE_ROWS);
  });

  it("returns null when the pet is disabled", () => {
    expect(parsePetSprite({ enabled: false })).toBeNull();
  });
});

describe("derivePose — Hermes's own priority ladder", () => {
  it("puts an error above everything", () => {
    expect(
      derivePose({ busy: true, celebrate: true, error: true, toolRunning: true }),
    ).toBe("failed");
  });

  it("waves on a finished turn before settling to idle", () => {
    expect(derivePose({ justCompleted: true })).toBe("wave");
  });

  it("prefers waiting-on-you over merely busy", () => {
    expect(derivePose({ awaitingInput: true, busy: true })).toBe("waiting");
  });

  it("shows a tool run as running and thinking as review", () => {
    expect(derivePose({ busy: true, toolRunning: true })).toBe("run");
    expect(derivePose({ busy: true, reasoning: true })).toBe("review");
  });

  it("falls back to run for plain busy, and idle for nothing", () => {
    expect(derivePose({ busy: true })).toBe("run");
    expect(derivePose({})).toBe("idle");
  });
});

describe("rowForPose", () => {
  it("finds the row under Hermes's own short name", () => {
    expect(rowForPose("jump", LEGACY_STATE_ROWS)).toBe(5);
  });

  it("follows petdex's spelling when the sheet uses it", () => {
    // A "waving"/"jumping"/"running" sheet must not silently draw idle.
    const codex = ["idle", "running-right", "running-left", "waving", "jumping"];
    expect(rowForPose("wave", codex)).toBe(3);
    expect(rowForPose("jump", codex)).toBe(4);
    expect(rowForPose("run", codex)).toBe(1);
  });

  it("falls back to idle rather than throwing on an unknown layout", () => {
    expect(rowForPose("review", ["idle"])).toBe(0);
  });
});

describe("framesForPose / framePosition / frameDelayMs", () => {
  it("uses the per-row frame count when the sheet gave one", () => {
    const sprite: PetSprite = {
      ...SHEET,
      framesByState: { waving: 4 },
      stateRows: ["idle", "waving"],
    };
    expect(framesForPose("wave", sprite)).toBe(4);
    expect(framesForPose("idle", sprite)).toBe(6); // falls back to framesPerState
  });

  it("offsets by frame and row in pixels", () => {
    expect(framePosition("wave", 2, SHEET)).toBe("-384px -208px");
  });

  it("wraps the frame index instead of running off the sheet", () => {
    // The animation counter climbs forever; the sheet has six frames.
    expect(framePosition("idle", 6, SHEET)).toBe(framePosition("idle", 0, SHEET));
    expect(framePosition("idle", -1, SHEET)).toBe(framePosition("idle", 5, SHEET));
  });

  it("splits the loop across the frames it really has", () => {
    expect(frameDelayMs("idle", SHEET)).toBe(183);
    const short: PetSprite = { ...SHEET, framesByState: { idle: 2 } };
    expect(frameDelayMs("idle", short)).toBe(550);
  });
});

describe("parsePetGallery", () => {
  it("reads installed and generated flags", () => {
    const rows = parsePetGallery({
      active: "meo",
      enabled: true,
      pets: [
        {
          displayName: "Mèo",
          installed: true,
          slug: "meo",
          spritesheetUrl: "https://petdex.dev/curated/meo.webp",
        },
        { generated: true, installed: true, slug: "tu-ve", spritesheetUrl: "" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ generated: true, slug: "tu-ve" });
    // A locally-made pet has no display name of its own in the payload.
    expect(rows[1].displayName).toBe("tu-ve");
  });

  it("is empty when the pet feature is off", () => {
    expect(parsePetGallery({ enabled: false, pets: [] })).toEqual([]);
  });

  it("names the active slug", () => {
    expect(activeGallerySlug({ active: "meo", enabled: true })).toBe("meo");
  });
});

describe("clampScale", () => {
  it("mirrors the server's own clamp so the slider cannot ask for a rejection", () => {
    expect(clampScale(9)).toBe(3);
    expect(clampScale(0)).toBe(0.1);
    expect(clampScale(0.5)).toBe(0.5);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe("poseLabelVi", () => {
  it("describes what it is doing, not a mood it does not have", () => {
    expect(poseLabelVi("run")).toBe("đang chạy việc");
    expect(poseLabelVi("waiting")).toBe("đang đợi anh");
    expect(poseLabelVi("idle")).toBe("đang rảnh");
  });
});
