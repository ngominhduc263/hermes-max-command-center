/**
 * Hermes's pet — the animated mascot, read honestly.
 *
 * ── What Hermes's pet actually is ───────────────────────────────────────
 *
 * It is **not** a tamagotchi. Hermes's own config comment calls it "a purely
 * cosmetic sprite that reacts to agent activity". There is no mood, hunger,
 * XP, level, age, streak, feeding or care timer anywhere in the feature — the
 * whole persisted record is five fields:
 *
 *     pets/<slug>/pet.json  {id, displayName, description, spritesheetPath,
 *                            createdBy}
 *
 * plus `display.pet.{enabled,slug,scale}` in config. So this module builds no
 * stats strip, no evolution stage, no "born on" date and no care streak: there
 * is no field behind any of them.
 *
 * ── Where the picture comes from ────────────────────────────────────────
 *
 * `pet.info` returns the spritesheet itself as base64 (WebP or PNG) plus its
 * geometry: 192×208 frames, 6 frames per state, ~1100ms per loop, and
 * `stateRows` naming which row is which state. Two atlas layouts exist in the
 * wild (an 8-row legacy one and a 9-row "codex" one) and Hermes infers which
 * from the image height — so this module **trusts the server's `stateRows`**
 * rather than re-deriving the layout, and only falls back when it is absent.
 *
 * The sheet is multi-megabyte, so `pet.info` takes a `knownRevision` and
 * answers `spritesheetUnchanged: true` when it matches. Honour that or the
 * panel re-downloads the whole atlas on every poll.
 *
 * ── The pose is ours to compute ─────────────────────────────────────────
 *
 * The gateway never sends the pose. `pet.cells` takes the state as an *input*,
 * and `pet.info` has no state field at all. Every Hermes surface derives it
 * locally from the same priority ladder, so this module mirrors it exactly
 * (agent/pet/state.py::derive_pet_state) rather than inventing a nicer one:
 *
 *     error → failed · celebrate → jump · just finished → wave ·
 *     waiting on you → waiting · tool running → run · thinking → review ·
 *     busy → run · otherwise → idle
 *
 * ── Refreshing ──────────────────────────────────────────────────────────
 *
 * `pet.changed` is a real broadcast, but it is a **server-side file-watcher
 * poll** that samples at most every 2 seconds — it tells you the sprite,
 * name or scale changed, never the pose. There is no pose event to subscribe
 * to, and none is faked here.
 */

/** The seven poses a spritesheet can carry. */
export type PetPose =
  | "idle"
  | "wave"
  | "run"
  | "failed"
  | "review"
  | "jump"
  | "waiting";

/** The row order Hermes assumes when the server did not name the rows. */
export const LEGACY_STATE_ROWS = [
  "idle",
  "wave",
  "run",
  "failed",
  "review",
  "jump",
  "extra1",
  "extra2",
];

/**
 * petdex spells three of the states differently. Hermes reconciles them with
 * an alias table; without it a "waving" sheet would silently render row 0.
 */
const POSE_ALIASES: Record<string, string[]> = {
  jump: ["jump", "jumping"],
  run: ["run", "running", "running-right", "running-left"],
  wave: ["wave", "waving"],
};

/** What `pet.info.meta` (and the `pet.changed` broadcast) carry. */
export interface PetMeta {
  enabled: boolean;
  slug: string;
  displayName: string;
  scale: number;
  revision: string;
}

/** The full `pet.info` payload, once a sheet has been received. */
export interface PetSprite extends PetMeta {
  dataUri: string;
  frameW: number;
  frameH: number;
  loopMs: number;
  /** Row order, server-supplied where possible. */
  stateRows: string[];
  /** Frame count per row name, when the server broke it down. */
  framesByState: Record<string, number>;
  framesPerState: number;
}

/** One row of `pet.gallery`. */
export interface PetGalleryEntry {
  slug: string;
  displayName: string;
  installed: boolean;
  spritesheetUrl: string;
  /** Made locally by the image generator rather than installed from petdex. */
  generated: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Read `pet.info.meta`, or a `pet.changed` payload — they share a shape. */
export function parsePetMeta(raw: unknown): PetMeta {
  const record = asRecord(raw);
  const off: PetMeta = {
    displayName: "",
    enabled: false,
    revision: "",
    scale: 1,
    slug: "",
  };
  if (!record || record.enabled !== true) return off;
  return {
    displayName: str(record.displayName).trim(),
    enabled: true,
    revision: str(record.spritesheetRevision),
    scale: num(record.scale, 1),
    slug: str(record.slug).trim(),
  };
}

/**
 * Read a full `pet.info` reply.
 *
 * Returns null when the pet is off, or when the reply was the
 * `spritesheetUnchanged` short form — in that case the caller already holds
 * the sheet and should keep the one it has.
 */
export function parsePetSprite(raw: unknown): PetSprite | null {
  const record = asRecord(raw);
  if (!record || record.enabled !== true) return null;
  const base64 = str(record.spritesheetBase64);
  if (!base64) return null;

  const mime = str(record.mime) || "image/webp";
  const meta = parsePetMeta(record);
  const rows = Array.isArray(record.stateRows)
    ? (record.stateRows as unknown[]).map((row) => str(row)).filter(Boolean)
    : [];

  const framesByState: Record<string, number> = {};
  const rawFrames = asRecord(record.framesByState);
  if (rawFrames) {
    for (const [key, value] of Object.entries(rawFrames)) {
      const count = num(value, 0);
      if (count > 0) framesByState[key] = Math.floor(count);
    }
  }

  return {
    ...meta,
    dataUri: `data:${mime};base64,${base64}`,
    frameH: Math.max(1, Math.floor(num(record.frameH, 208))),
    framesByState,
    framesPerState: Math.max(1, Math.floor(num(record.framesPerState, 6))),
    frameW: Math.max(1, Math.floor(num(record.frameW, 192))),
    loopMs: Math.max(120, Math.floor(num(record.loopMs, 1100))),
    stateRows: rows.length ? rows : LEGACY_STATE_ROWS,
  };
}

/** True when `pet.info` said "you already have this sheet". */
export function spriteUnchanged(raw: unknown): boolean {
  return asRecord(raw)?.spritesheetUnchanged === true;
}

/** Read `pet.gallery`. */
export function parsePetGallery(raw: unknown): PetGalleryEntry[] {
  const record = asRecord(raw);
  if (!record || record.enabled !== true) return [];
  const rows = Array.isArray(record.pets) ? record.pets : [];
  const out: PetGalleryEntry[] = [];
  for (const row of rows) {
    const entry = asRecord(row);
    const slug = str(entry?.slug).trim();
    if (!entry || !slug) continue;
    out.push({
      displayName: str(entry.displayName).trim() || slug,
      generated: entry.generated === true,
      installed: entry.installed === true,
      slug,
      spritesheetUrl: str(entry.spritesheetUrl),
    });
  }
  return out;
}

/** Which slug `pet.gallery` says is active. */
export function activeGallerySlug(raw: unknown): string {
  return str(asRecord(raw)?.active).trim();
}

/** What the chat currently looks like, as far as the pose ladder cares. */
export interface PetActivity {
  busy?: boolean;
  awaitingInput?: boolean;
  error?: boolean;
  justCompleted?: boolean;
  toolRunning?: boolean;
  reasoning?: boolean;
  celebrate?: boolean;
}

/**
 * The pose, in Hermes's own priority order.
 *
 * Mirrors `agent/pet/state.py::derive_pet_state` exactly — including that
 * `busy` loses to everything more specific, and that a finished turn waves
 * before an idle pet settles.
 */
export function derivePose(activity: PetActivity): PetPose {
  if (activity.error) return "failed";
  if (activity.celebrate) return "jump";
  if (activity.justCompleted) return "wave";
  if (activity.awaitingInput) return "waiting";
  if (activity.toolRunning) return "run";
  if (activity.reasoning) return "review";
  if (activity.busy) return "run";
  return "idle";
}

/**
 * Which row of the atlas draws this pose.
 *
 * Falls back to row 0 rather than throwing: Hermes does the same, because a
 * sheet with an unexpected row set should still show *something*.
 */
export function rowForPose(pose: PetPose, stateRows: string[]): number {
  const candidates = POSE_ALIASES[pose] ?? [pose];
  for (const name of candidates) {
    const index = stateRows.indexOf(name);
    if (index >= 0) return index;
  }
  return 0;
}

/** How many frames this pose's row actually has. */
export function framesForPose(pose: PetPose, sprite: PetSprite): number {
  const candidates = POSE_ALIASES[pose] ?? [pose];
  for (const name of candidates) {
    const count = sprite.framesByState[name];
    if (count && count > 0) return count;
  }
  return sprite.framesPerState;
}

/** The `background-position` for one frame of one pose. */
export function framePosition(
  pose: PetPose,
  frame: number,
  sprite: PetSprite,
): string {
  const frames = framesForPose(pose, sprite);
  const column = ((frame % frames) + frames) % frames;
  const row = rowForPose(pose, sprite.stateRows);
  return `-${column * sprite.frameW}px -${row * sprite.frameH}px`;
}

/** Milliseconds each frame is held, so a loop lasts `loopMs`. */
export function frameDelayMs(pose: PetPose, sprite: PetSprite): number {
  return Math.max(40, Math.round(sprite.loopMs / framesForPose(pose, sprite)));
}

/** Hermes clamps scale to this range server-side; mirror it in the slider. */
export const PET_SCALE_MIN = 0.1;
export const PET_SCALE_MAX = 3;

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, value));
}

/** What the pet is doing, in Vietnamese — for the tooltip and screen readers. */
export function poseLabelVi(pose: PetPose): string {
  switch (pose) {
    case "failed":
      return "vừa có lỗi";
    case "jump":
      return "ăn mừng";
    case "wave":
      return "vừa xong việc";
    case "waiting":
      return "đang đợi anh";
    case "run":
      return "đang chạy việc";
    case "review":
      return "đang suy nghĩ";
    default:
      return "đang rảnh";
  }
}
