import { Button } from "@nous-research/ui/ui/components/button";
import {
  Check,
  Cpu,
  LoaderCircle,
  Plus,
  Search,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import {
  addFavorite,
  FAVORITE_MODELS_KEY,
  FAVORITE_MODELS_LIMIT,
  isFavorite,
  modelShortLabel,
  normalizeModelId,
  parseFavorites,
  removeFavorite,
  sameModel,
  searchModelOptions,
  serializeFavorites,
  type FavoriteModel,
} from "@/lib/chat-favorite-models";
import { cn } from "@/lib/utils";

/**
 * Quick model switcher for the chat toolbar.
 *
 * The control panel already has a model picker, but it is a setup surface —
 * provider list, model list, save. This is the everyday one: the two or three
 * models the user actually alternates between, one click each, without leaving
 * the composer. The switch itself is the same `/model <id>` the control panel
 * drives, handed in as `onSwitch`.
 */

interface FavoriteModelSwitchProps {
  /** Drives `/model <id>` into the live PTY. Resolves false if it did not land. */
  onSwitch: (model: string) => Promise<boolean>;
  /**
   * Fired after a switch that also landed in config, so the control panel's
   * model badge — which reads `/api/model/info` — re-reads instead of sitting
   * on the value it happened to load at mount.
   */
  onModelChanged?: () => void;
  disabled?: boolean;
  profile?: string;
}

export function FavoriteModelSwitch({
  onSwitch,
  onModelChanged,
  disabled,
  profile,
}: FavoriteModelSwitchProps) {
  const [favorites, setFavorites] = useState<FavoriteModel[]>(() => {
    try {
      return parseFavorites(window.localStorage.getItem(FAVORITE_MODELS_KEY));
    } catch {
      // Private mode, blocked storage: an empty bar still works, it just does
      // not remember. Never let this throw during the first render.
      return [];
    }
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [options, setOptions] = useState<FavoriteModel[] | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Set when `/api/model/set` comes back asking to confirm an expensive model.
  // Nothing has been switched at that point — the user gets the same warning
  // the control panel's picker shows, and decides.
  const [pendingConfirm, setPendingConfirm] = useState<{
    id: string;
    message: string;
    provider: string;
  } | null>(null);
  // What the session is running, and under which provider. Seeded from config;
  // kept current by our own switches.
  const [current, setCurrent] = useState("");
  const [currentProvider, setCurrentProvider] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const info = await api.getModelInfo(profile);
        if (!alive) return;
        if (typeof info?.model === "string") setCurrent(info.model);
        if (typeof info?.provider === "string") setCurrentProvider(info.provider);
      } catch {
        // Only a badge. Without it the switcher still switches.
      }
    })();
    return () => {
      alive = false;
    };
  }, [profile]);

  const persist = useCallback((next: FavoriteModel[]) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITE_MODELS_KEY, serializeFavorites(next));
    } catch {
      /* storage blocked — the list still works for this page's lifetime */
    }
  }, []);

  // Model ids are long; the provider list is the only place to get them right
  // without typing. Cached in a ref as well as state because a switch needs it
  // too — `/api/model/set` will not take a model without its provider.
  const optionsRef = useRef<FavoriteModel[] | null>(null);
  const loadOptions = useCallback(async (): Promise<FavoriteModel[]> => {
    if (optionsRef.current) return optionsRef.current;
    const response = await api.getModelOptions({ profile });
    const rows: FavoriteModel[] = [];
    for (const provider of response?.providers ?? []) {
      for (const model of provider.models ?? []) {
        if (typeof model === "string" && model.trim()) {
          rows.push({ id: model.trim(), provider: provider.slug });
        }
      }
    }
    optionsRef.current = rows;
    return rows;
  }, [profile]);

  // Fetched on first open, not at mount: most sessions never touch this.
  useEffect(() => {
    if (!open || options !== null) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await loadOptions();
        if (!alive) return;
        setOptions(rows);
        setOptionsError("");
      } catch (error) {
        if (!alive) return;
        // The list is a convenience — the box still takes a typed id.
        setOptions([]);
        setOptionsError(
          error instanceof Error ? error.message : "không tải được danh sách",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadOptions, open, options]);

  /**
   * Which provider owns this model. The favourite remembers one when it was
   * added from the list; otherwise look it up, and fall back to whatever the
   * session is on — a bare id typed by hand is almost always a sibling of the
   * model already in use.
   */
  const resolveProvider = useCallback(
    async (id: string, hint?: string): Promise<string> => {
      if (hint?.trim()) return hint.trim();
      try {
        const rows = await loadOptions();
        const hit = rows.find((row) => sameModel(row.id, id));
        if (hit?.provider) return hit.provider;
      } catch {
        /* fall through to the session's own provider */
      }
      return currentProvider;
    },
    [currentProvider, loadOptions],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Capture phase: a click on the trigger toggles before this can close it.
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const suggestions = useMemo(
    () => (options?.length ? searchModelOptions(draft, options, 30) : []),
    [draft, options],
  );

  const draftId = normalizeModelId(draft);

  /**
   * What "Thêm" actually adds. The box doubles as a search field, so the raw
   * text is often a fragment — adding `glm` verbatim would file a favourite
   * that no provider can serve. Prefer a real model: an exact hit first, then
   * the best suggestion (the leftmost chip below, so it is on screen), and only
   * fall back to the typed text when the options list knows nothing like it.
   */
  const addTarget = useMemo<FavoriteModel | null>(() => {
    if (!draftId) return null;
    const exact = (options ?? []).find((row) => sameModel(row.id, draftId));
    if (exact) return exact;
    if (suggestions.length) return suggestions[0];
    return { id: draftId };
  }, [draftId, options, suggestions]);

  /**
   * A switch is two writes, and both matter.
   *
   * `/model <id>` moves the session that is running right now — that is the
   * whole point of the control. But it does not touch config.yaml, so the
   * control panel's "mô hình" badge (which reads `/api/model/info`) would keep
   * showing the old one, and the next session would boot on it too. So write
   * config first — that is also where the expensive-model warning lives, and
   * the user should see it before anything switches — and only then hand the
   * model to the live PTY.
   *
   * A config write that fails for any other reason is not fatal: the live
   * switch still happens, and the note says the panel stayed behind.
   */
  const switchTo = useCallback(
    async (
      model: string,
      settings: { provider?: string; confirmExpensive?: boolean } = {},
    ) => {
      const id = normalizeModelId(model);
      if (!id || switching) return;
      setSwitching(id);
      setPendingConfirm(null);
      setNote(`Đang đổi sang ${modelShortLabel(id)}…`);

      let savedToConfig = false;
      try {
        const provider = await resolveProvider(id, settings.provider);
        if (provider) {
          try {
            const result = await api.setModelAssignment(
              {
                confirm_expensive_model: settings.confirmExpensive ?? false,
                model: id,
                provider,
                scope: "main",
              },
              profile,
            );
            if (result?.confirm_required) {
              // Nothing has changed yet. Show the warning and let the user say.
              setPendingConfirm({
                id,
                message: result.confirm_message ?? "",
                provider,
              });
              setNote("");
              setSwitching(null);
              return;
            }
            savedToConfig = result?.ok !== false;
          } catch {
            // Config is the follow-up; the live switch below is the feature.
          }
        }

        const ok = await onSwitch(id);
        if (savedToConfig) onModelChanged?.();
        if (ok) {
          setCurrent(id);
          if (provider) setCurrentProvider(provider);
          setNote(
            savedToConfig
              ? `Đã đổi sang ${modelShortLabel(id)}.`
              : `Đã đổi phiên này sang ${modelShortLabel(id)} — nhưng chưa ghi được vào cấu hình, nên bảng điều khiển vẫn hiện model cũ.`,
          );
          // Only get out of the way when there is nothing to read. A half
          // switch closed instantly is a warning the user never sees.
          if (savedToConfig) setOpen(false);
        } else {
          setNote("Chưa gửi được lệnh đổi model — kiểm tra kết nối Terminal.");
        }
      } catch (error) {
        setNote(
          error instanceof Error
            ? `Lỗi: ${error.message}`
            : "Lỗi khi đổi model.",
        );
      } finally {
        setSwitching(null);
      }
    },
    [onModelChanged, onSwitch, profile, resolveProvider, switching],
  );

  const add = useCallback(
    (model: FavoriteModel | string) => {
      const next = addFavorite(favorites, model);
      if (next === favorites) return;
      persist(next);
      setDraft("");
      setNote(`Đã thêm ${modelShortLabel(next[0].id)} vào danh sách.`);
    },
    [favorites, persist],
  );

  const full = favorites.length >= FAVORITE_MODELS_LIMIT;

  return (
    <div className="hermes-model-switch" ref={panelRef}>
      <Button
        ghost
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(open && "is-active")}
        prefix={<Cpu className="h-4 w-4" />}
        title="Đổi nhanh sang model thường dùng"
      >
        <span>
          Model
          {current ? (
            <em className="hermes-model-switch-current">
              {modelShortLabel(current)}
            </em>
          ) : null}
        </span>
      </Button>

      {open ? (
        <div className="hermes-model-switch-panel" role="dialog" aria-label="Model thường dùng">
          <header>
            <strong>
              <Star className="h-3.5 w-3.5" /> Model thường dùng
            </strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          {favorites.length ? (
            <ul className="hermes-model-switch-list">
              {favorites.map((entry) => {
                const active = current && sameModel(entry.id, current);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={cn(active && "is-current")}
                      disabled={disabled || switching !== null}
                      onClick={() =>
                        void switchTo(entry.id, { provider: entry.provider })
                      }
                      title={entry.id}
                    >
                      {switching === entry.id ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : active ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Cpu className="h-3.5 w-3.5" />
                      )}
                      <span className="hermes-model-switch-name">
                        {modelShortLabel(entry.id)}
                      </span>
                      <span className="hermes-model-switch-id">{entry.id}</span>
                    </button>
                    <button
                      type="button"
                      className="hermes-model-switch-remove"
                      onClick={() => persist(removeFavorite(favorites, entry.id))}
                      aria-label={`Gỡ ${entry.id} khỏi danh sách`}
                      title="Gỡ khỏi danh sách"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hermes-model-switch-empty">
              Chưa có model nào. Thêm model hay dùng vào đây để đổi chỉ bằng một
              cú bấm.
            </p>
          )}

          <div className="hermes-model-switch-add">
            <label>
              <Search className="h-3.5 w-3.5" />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && addTarget) {
                    event.preventDefault();
                    add(addTarget);
                  }
                }}
                placeholder="Thêm model thường dùng — gõ tên hoặc chọn bên dưới"
                disabled={full}
              />
              <Button
                size="sm"
                onClick={() => addTarget && add(addTarget)}
                disabled={
                  !addTarget || full || isFavorite(favorites, addTarget.id)
                }
                prefix={<Plus className="h-3.5 w-3.5" />}
                title={addTarget ? `Thêm ${addTarget.id}` : "Thêm model"}
              >
                Thêm
              </Button>
            </label>

            {current && !isFavorite(favorites, current) && !full ? (
              <button
                type="button"
                className="hermes-model-switch-add-current"
                onClick={() => add(current)}
              >
                <Plus className="h-3 w-3" /> Thêm model đang dùng ·{" "}
                {modelShortLabel(current)}
              </button>
            ) : null}

            {full ? (
              <p className="hermes-model-switch-note">
                Danh sách đã đủ {FAVORITE_MODELS_LIMIT} model — gỡ bớt một cái
                rồi thêm tiếp nha.
              </p>
            ) : options === null ? (
              <p className="hermes-model-switch-note">
                <LoaderCircle className="h-3 w-3 animate-spin" /> Đang tải danh
                sách model…
              </p>
            ) : suggestions.length ? (
              <div className="hermes-model-switch-options">
                {suggestions.map((option) => (
                  <button
                    key={`${option.provider ?? ""}/${option.id}`}
                    type="button"
                    disabled={isFavorite(favorites, option.id)}
                    onClick={() => add(option)}
                    title={option.id}
                  >
                    <span>{modelShortLabel(option.id)}</span>
                    {option.provider ? <em>{option.provider}</em> : null}
                  </button>
                ))}
              </div>
            ) : optionsError ? (
              <p className="hermes-model-switch-note">
                <TriangleAlert className="h-3 w-3" /> Không tải được danh sách
                model ({optionsError}) — gõ tên model vào ô trên cũng được.
              </p>
            ) : (
              <p className="hermes-model-switch-note">
                Không có model nào khớp “{draft.trim()}” — vẫn có thể thêm thẳng
                tên đó.
              </p>
            )}
          </div>

          {pendingConfirm ? (
            <div className="hermes-model-switch-confirm">
              <p>
                <TriangleAlert className="h-3.5 w-3.5" />
                {pendingConfirm.message ||
                  `${modelShortLabel(pendingConfirm.id)} là model đắt tiền.`}
              </p>
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    void switchTo(pendingConfirm.id, {
                      confirmExpensive: true,
                      provider: pendingConfirm.provider,
                    })
                  }
                >
                  Vẫn đổi
                </Button>
                <Button
                  ghost
                  size="sm"
                  onClick={() => {
                    setPendingConfirm(null);
                    setNote("Đã huỷ, chưa đổi model.");
                  }}
                >
                  Thôi
                </Button>
              </div>
            </div>
          ) : null}

          {note ? <footer>{note}</footer> : null}
        </div>
      ) : null}
    </div>
  );
}
