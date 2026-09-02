import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, PawPrint, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  activeGallerySlug,
  clampScale,
  derivePose,
  frameDelayMs,
  framePosition,
  parsePetGallery,
  parsePetMeta,
  parsePetSprite,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  poseLabelVi,
  spriteUnchanged,
  type PetActivity,
  type PetGalleryEntry,
  type PetSprite,
} from "@/lib/hermes-pet";

/** Set a value on the next microtask, so an effect body stays render-free. */
function setFrameSafely(set: (value: number) => void, value: number): void {
  void Promise.resolve().then(() => set(value));
}

interface PetCornerProps {
  /** One gateway RPC. Rejects like any other call. */
  call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  /** What the chat is doing right now — the pose is derived from this. */
  activity: PetActivity;
  /** Bumped by the caller when a `pet.changed` broadcast arrives. */
  changeTick?: number;
}

/**
 * The pet, in the corner of the chat.
 *
 * Hermes's pet is a cosmetic sprite and nothing more — no mood, hunger, XP or
 * age exists to display, so this shows the animation, the name, and the two
 * settings that are real (which pet, how big).
 *
 * The pose is computed here because the gateway never sends one: `pet.cells`
 * takes the state as an input and `pet.info` has no state field. `derivePose`
 * mirrors Hermes's own priority ladder so the Dashboard pet and the terminal
 * pet agree.
 *
 * The spritesheet is multi-megabyte, so it is fetched once and re-fetched only
 * when the revision changes — `pet.info` answers `spritesheetUnchanged` when
 * the `knownRevision` we send still matches.
 */
export function PetCorner({ call, activity, changeTick = 0 }: PetCornerProps) {
  const [sprite, setSprite] = useState<PetSprite | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [frame, setFrame] = useState(0);
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState<PetGalleryEntry[] | null>(null);
  const [activeSlug, setActiveSlug] = useState("");
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");

  const revisionRef = useRef("");
  const pose = useMemo(() => derivePose(activity), [activity]);

  const load = useCallback(async () => {
    try {
      const meta = parsePetMeta(await call<unknown>("pet.info.meta"));
      if (!meta.enabled) {
        setEnabled(false);
        setSprite(null);
        return;
      }
      setEnabled(true);
      // Ask for the sheet only when the revision moved; otherwise the reply
      // is the short form and we keep the atlas we already hold.
      const reply = await call<unknown>("pet.info", {
        knownRevision: revisionRef.current,
      });
      if (spriteUnchanged(reply)) {
        setSprite((current) => (current ? { ...current, ...meta } : current));
        return;
      }
      const next = parsePetSprite(reply);
      if (next) {
        revisionRef.current = next.revision;
        setSprite(next);
      }
    } catch {
      // A pet that cannot be read is not worth an error banner in the chat.
      setEnabled(false);
    }
  }, [call]);

  useEffect(() => {
    // Deferred a microtask: the loader's first action is a setState, and
    // running that synchronously inside the effect cascades a render.
    void Promise.resolve().then(load);
  }, [load, changeTick]);

  // One timer, re-armed per pose so a four-frame wave and a six-frame run
  // both finish their loop in `loopMs`.
  useEffect(() => {
    if (!sprite) return;
    // The reset rides the same timer rather than firing synchronously, so a
    // pose change does not cascade an extra render before the first frame.
    let frameIndex = 0;
    setFrameSafely(setFrame, 0);
    const timer = window.setInterval(() => {
      frameIndex += 1;
      setFrame(frameIndex);
    }, frameDelayMs(pose, sprite));
    return () => window.clearInterval(timer);
  }, [pose, sprite]);

  const openGallery = useCallback(async () => {
    setOpen(true);
    if (gallery !== null) return;
    try {
      const reply = await call<unknown>("pet.gallery", {});
      setGallery(parsePetGallery(reply));
      setActiveSlug(activeGallerySlug(reply));
    } catch {
      setGallery([]);
    }
  }, [call, gallery]);

  const choose = useCallback(
    async (slug: string) => {
      setBusy(slug);
      setFailure("");
      try {
        await call("pet.select", { slug });
        revisionRef.current = "";
        setActiveSlug(slug);
        await load();
        setOpen(false);
      } catch (reason: unknown) {
        setFailure(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy("");
      }
    },
    [call, load],
  );

  const resize = useCallback(
    async (value: number) => {
      const scale = clampScale(value);
      setSprite((current) => (current ? { ...current, scale } : current));
      try {
        await call("pet.scale", { scale });
      } catch {
        /* cosmetic — the next load reconciles it */
      }
    },
    [call],
  );

  const turnOff = useCallback(async () => {
    try {
      await call("pet.disable", {});
      setEnabled(false);
      setSprite(null);
      setOpen(false);
    } catch (reason: unknown) {
      setFailure(reason instanceof Error ? reason.message : String(reason));
    }
  }, [call]);

  if (!enabled || !sprite) return null;

  const scale = clampScale(sprite.scale || 1);
  const width = Math.round(sprite.frameW * scale);
  const height = Math.round(sprite.frameH * scale);

  return (
    <div className="hermes-pet">
      <button
        type="button"
        className="hermes-pet-stage"
        style={{ height, width }}
        title={`${sprite.displayName} — ${poseLabelVi(pose)}`}
        aria-label={`${sprite.displayName}, ${poseLabelVi(pose)}`}
        onClick={() => (open ? setOpen(false) : void openGallery())}
      >
        <span
          className="hermes-pet-sprite"
          style={{
            backgroundImage: `url(${sprite.dataUri})`,
            backgroundPosition: framePosition(pose, frame, sprite),
            height: sprite.frameH,
            transform: `scale(${scale})`,
            width: sprite.frameW,
          }}
        />
      </button>

      {open ? (
        <div className="hermes-pet-panel">
          <header>
            <PawPrint className="h-3.5 w-3.5" />
            <strong>{sprite.displayName}</strong>
            <span>{poseLabelVi(pose)}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <label className="hermes-pet-scale">
            <span>Cỡ</span>
            <input
              type="range"
              min={PET_SCALE_MIN}
              max={PET_SCALE_MAX}
              step={0.05}
              value={scale}
              onChange={(event) => void resize(Number(event.currentTarget.value))}
            />
            <code>{scale.toFixed(2)}×</code>
          </label>

          <p className="hermes-pet-note">
            Pet của Hermes chỉ là hình động — không có mức đói, cấp độ hay tâm
            trạng nào cả. Dáng của nó đi theo việc Hermes đang làm.
          </p>

          <div className="hermes-pet-list">
            {gallery === null ? (
              <p className="hermes-pet-muted">
                <LoaderCircle className="h-3 w-3 animate-spin" /> Đang tải…
              </p>
            ) : !gallery.length ? (
              <p className="hermes-pet-muted">Không đọc được danh sách pet.</p>
            ) : (
              gallery.map((entry) => (
                <button
                  key={entry.slug}
                  type="button"
                  disabled={busy === entry.slug}
                  className={cn(entry.slug === activeSlug && "is-active")}
                  onClick={() => void choose(entry.slug)}
                >
                  {busy === entry.slug ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : null}
                  <span>{entry.displayName}</span>
                  {entry.generated ? <i>tự tạo</i> : null}
                  {!entry.installed ? <em>tải về</em> : null}
                </button>
              ))
            )}
          </div>

          {failure ? <p className="hermes-pet-bad">{failure}</p> : null}

          <button
            type="button"
            className="hermes-pet-off"
            onClick={() => void turnOff()}
          >
            <ChevronDown className="h-3 w-3" />
            Cất pet đi
          </button>
        </div>
      ) : null}
    </div>
  );
}
