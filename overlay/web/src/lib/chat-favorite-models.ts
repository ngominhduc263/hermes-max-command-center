/**
 * The chat toolbar's quick model switcher.
 *
 * The control panel's model picker is a *setup* surface: it writes config for
 * the next session and (since v2.11.0) drives `/model <id>` into the live PTY.
 * Fine for choosing a default, far too many clicks for the thing this is
 * actually for — bouncing between the two or three models the user works with
 * all day, mid-conversation.
 *
 * So the user keeps their own short list. It lives in localStorage rather than
 * Hermes config on purpose: it is a per-browser convenience, it must survive a
 * dashboard restart, and writing it into config would fight the real model
 * assignment every time it saved.
 *
 * Everything here is pure so the list logic is testable without a DOM.
 */

export interface FavoriteModel {
  /** Model id exactly as `/model` wants it, e.g. `z-ai/glm-5.3-flash`. */
  id: string;
  /** Provider slug, when it was added from the options list. */
  provider?: string;
}

export const FAVORITE_MODELS_KEY = "hermes-max-favorite-models";

/** A quick-switch bar stops being quick well before this. */
export const FAVORITE_MODELS_LIMIT = 12;

/**
 * Clean up whatever was typed into the add box: people paste `/model foo`,
 * quote it, or leave a trailing space from a copy.
 */
export function normalizeModelId(raw: string): string {
  return raw
    .trim()
    // Anchored on a space or the end, so `/model-something` is left alone.
    .replace(/^\/model(?:\s+|$)/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"openrouter/z-ai/glm-5.3-flash"` → `"glm-5.3-flash"`, for a tight chip. */
export function modelShortLabel(id: string): string {
  const tail = id.split("/").pop() ?? id;
  return tail || id;
}

/** True when the two ids name the same model, ignoring case. */
export function sameModel(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function isFavorite(list: FavoriteModel[], id: string): boolean {
  const wanted = normalizeModelId(id);
  return list.some((entry) => sameModel(entry.id, wanted));
}

/**
 * Add to the front — the most recently added is the one being used right now,
 * so it should be the easiest to hit. Re-adding an existing model moves it up
 * rather than duplicating it.
 */
export function addFavorite(
  list: FavoriteModel[],
  entry: FavoriteModel | string,
): FavoriteModel[] {
  const next: FavoriteModel =
    typeof entry === "string" ? { id: entry } : { ...entry };
  next.id = normalizeModelId(next.id);
  if (!next.id) return list;
  if (!next.provider) delete next.provider;
  return [
    next,
    ...list.filter((existing) => !sameModel(existing.id, next.id)),
  ].slice(0, FAVORITE_MODELS_LIMIT);
}

export function removeFavorite(
  list: FavoriteModel[],
  id: string,
): FavoriteModel[] {
  const wanted = normalizeModelId(id);
  return list.filter((entry) => !sameModel(entry.id, wanted));
}

/**
 * Read the stored list. Anything unreadable — bad JSON, an older shape, a
 * hand-edited value — degrades to an empty list rather than throwing inside a
 * `useState` initialiser and taking the whole chat down.
 */
export function parseFavorites(raw: string | null | undefined): FavoriteModel[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: FavoriteModel[] = [];
  for (const item of parsed) {
    // Tolerate a plain array of ids, which is what a hand-written value
    // usually looks like.
    if (typeof item === "string") {
      const id = normalizeModelId(item);
      if (id && !out.some((entry) => sameModel(entry.id, id))) out.push({ id });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? normalizeModelId(record.id) : "";
    if (!id || out.some((entry) => sameModel(entry.id, id))) continue;
    const provider =
      typeof record.provider === "string" && record.provider.trim()
        ? record.provider.trim()
        : undefined;
    out.push(provider ? { id, provider } : { id });
  }
  return out.slice(0, FAVORITE_MODELS_LIMIT);
}

export function serializeFavorites(list: FavoriteModel[]): string {
  return JSON.stringify(list);
}

/** Options-list rows matching `query`, best-first, capped for the popover. */
export function searchModelOptions(
  query: string,
  options: FavoriteModel[],
  limit = 40,
): FavoriteModel[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return options.slice(0, limit);

  const scored: Array<{ option: FavoriteModel; score: number }> = [];
  for (const option of options) {
    const id = option.id.toLocaleLowerCase();
    const short = modelShortLabel(id);
    let score = -1;
    if (id === needle) score = 0;
    else if (short.startsWith(needle)) score = 1;
    else if (id.startsWith(needle)) score = 2;
    else if (id.includes(needle)) score = 3;
    else if ((option.provider ?? "").toLocaleLowerCase().includes(needle))
      score = 4;
    if (score >= 0) scored.push({ option, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.option.id.localeCompare(b.option.id))
    .slice(0, limit)
    .map((entry) => entry.option);
}
