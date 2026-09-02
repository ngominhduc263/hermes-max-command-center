/**
 * The session list: pinned first, then grouped by when it was last touched.
 *
 * A flat list ordered by recency stops being navigable at about thirty rows —
 * everything looks the same and the only way back to a conversation is to
 * remember its title. Hermes Desktop solves this with a Pinned section and
 * date buckets; both are reproduced here on the same data.
 *
 * ── Pinning is server-side, and shared ──────────────────────────────────
 *
 * `sessions.pinned` is a real column. `GET /api/sessions` always requests
 * pinned rows and **back-fills any that fall outside the LIMIT window**, so a
 * pinned conversation is always in the page even when it is 400 rows down;
 * Hermes added that deliberately so a sidebar would not render an empty
 * Pinned section. Writing is `PATCH /api/sessions/{id}` with `{pinned}`.
 *
 * The consequence worth knowing: this is the **same flag Hermes Desktop
 * writes**. Pin a chat in the Dashboard and it is pinned in Desktop too. What
 * is *not* shared is the ORDER — Desktop keeps that in its own localStorage
 * and there is no ordering column or endpoint — so pinned rows here are
 * ordered by recency rather than by a sequence that would silently disagree
 * with the other app.
 *
 * ── The timestamp ───────────────────────────────────────────────────────
 *
 * `last_active` is **epoch seconds as a float**, not milliseconds — it is
 * `COALESCE(MAX(last_activity_at, MAX(messages.timestamp)), started_at)`. A
 * missing value falls back to `started_at`. Multiplying by 1000 for `Date` is
 * the whole conversion, and getting it wrong puts every session in 1970.
 *
 * ── Why the buckets are calendar-based, not elapsed-time ────────────────
 *
 * "Hôm nay" means *today's date*, not "within 24 hours". A conversation from
 * 11pm last night is Yesterday at 1am, not Today — anything else disagrees
 * with the clock on the wall and makes the list feel wrong without the reader
 * being able to say why.
 */

/** The buckets, in the order they are rendered. */
export type SessionBucket =
  | "pinned"
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "older";

export interface GroupableSession {
  id: string;
  last_active?: number;
  started_at?: number;
  pinned?: boolean;
}

export interface SessionGroup<T> {
  bucket: SessionBucket;
  label: string;
  sessions: T[];
}

/** Epoch seconds for a row, preferring activity over creation. */
export function activityAt(session: GroupableSession): number {
  const active = session.last_active;
  if (typeof active === "number" && Number.isFinite(active) && active > 0) {
    return active;
  }
  const started = session.started_at;
  return typeof started === "number" && Number.isFinite(started) ? started : 0;
}

/** Midnight local time, as epoch seconds. */
function startOfDay(date: Date): number {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return Math.floor(copy.getTime() / 1000);
}

/**
 * Which bucket a timestamp falls in.
 *
 * `now` is injectable so the boundaries can be tested without waiting for
 * midnight.
 */
export function bucketFor(
  epochSeconds: number,
  now: Date = new Date(),
): Exclude<SessionBucket, "pinned"> {
  // A row with no usable timestamp goes to the bottom rather than being
  // silently dated to 1970 and claiming to be very old.
  if (!epochSeconds) return "older";

  const todayStart = startOfDay(now);
  if (epochSeconds >= todayStart) return "today";

  const day = 86400;
  if (epochSeconds >= todayStart - day) return "yesterday";
  // "This week" counts back seven calendar days from today's midnight, so it
  // never overlaps the Yesterday bucket.
  if (epochSeconds >= todayStart - day * 7) return "week";
  if (epochSeconds >= todayStart - day * 30) return "month";
  return "older";
}

export function bucketLabelVi(bucket: SessionBucket): string {
  switch (bucket) {
    case "pinned":
      return "Đã ghim";
    case "today":
      return "Hôm nay";
    case "yesterday":
      return "Hôm qua";
    case "week":
      return "7 ngày qua";
    case "month":
      return "30 ngày qua";
    default:
      return "Cũ hơn";
  }
}

const ORDER: SessionBucket[] = [
  "pinned",
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

/**
 * Group sessions for the sidebar.
 *
 * A pinned session appears **only** under Đã ghim — showing it twice would
 * make the list longer while carrying no more information.
 */
export function groupSessions<T extends GroupableSession>(
  sessions: T[],
  now: Date = new Date(),
): Array<SessionGroup<T>> {
  const buckets = new Map<SessionBucket, T[]>();

  for (const session of sessions) {
    const bucket: SessionBucket = session.pinned
      ? "pinned"
      : bucketFor(activityAt(session), now);
    const list = buckets.get(bucket);
    if (list) list.push(session);
    else buckets.set(bucket, [session]);
  }

  const groups: Array<SessionGroup<T>> = [];
  for (const bucket of ORDER) {
    const list = buckets.get(bucket);
    if (!list?.length) continue;
    // Newest first inside every bucket, pinned included: there is no shared
    // pin ordering to honour, so recency is the one rule that cannot
    // disagree with Desktop.
    list.sort((a, b) => activityAt(b) - activityAt(a));
    groups.push({ bucket, label: bucketLabelVi(bucket), sessions: list });
  }
  return groups;
}

/** How many sessions are pinned right now. */
export function pinnedCount(sessions: GroupableSession[]): number {
  return sessions.filter((session) => session.pinned).length;
}

/**
 * Optimistic pin state, applied over a list that may be mid-refresh.
 *
 * Desktop guards its own pin writes against list pages fetched before the
 * write landed. The same hazard exists here: a poll that started before the
 * PATCH returns rows with the old flag and would visibly un-pin the row the
 * user just pinned. Overrides win until the caller clears them.
 */
export function applyPinOverrides<T extends GroupableSession>(
  sessions: T[],
  overrides: Record<string, boolean>,
): T[] {
  if (!Object.keys(overrides).length) return sessions;
  return sessions.map((session) =>
    session.id in overrides
      ? { ...session, pinned: overrides[session.id] }
      : session,
  );
}

/** The action a click would take, for the button's label and title. */
export function pinActionVi(pinned: boolean): string {
  return pinned ? "Bỏ ghim" : "Ghim lên đầu";
}

/**
 * Said once under the Pinned heading.
 *
 * Worth stating: the flag is gateway-wide, so this is not a Dashboard-only
 * bookmark and it will show up in the Desktop app too.
 */
export function pinnedNoteVi(): string {
  return "Ghim dùng chung với app Desktop — ghim ở đây thì bên đó cũng thấy.";
}
