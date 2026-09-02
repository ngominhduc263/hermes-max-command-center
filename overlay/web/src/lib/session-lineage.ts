/**
 * Which session the chat should actually open.
 *
 * ── The bug this exists for ─────────────────────────────────────────────
 *
 * `/api/sessions/{id}/latest-descendant` walks `parent_session_id` recursively
 * with **no filter at all**, sorts the descendants by `started_at`, and returns
 * the newest leaf. ChatPage then rewrites `?resume=` to it.
 *
 * That resolver was written for one job — its own docstring says so: "/model
 * may create child sessions. Dashboard refresh should continue the newest child
 * instead of reopening the old parent." Model-switch continuations are children,
 * and following them is right.
 *
 * But **a delegated sub-agent's session is also a child**, and right after a
 * delegation batch it is the *newest* child. So the Dashboard would follow the
 * chain straight into a sub-agent's private transcript: the URL silently
 * changed to the child, the main conversation vanished from the chat, and the
 * Terminal (which reads the PTY, not the store) went on showing the real
 * conversation. Two faces of "the same session" showing completely different
 * content.
 *
 * Hermes marks these children itself, and this module reads those markers
 * rather than inventing a heuristic:
 *
 *   `model_config._delegate_from` — set on a delegated sub-agent's session.
 *   `source === "tool"`           — a tool-owned sidecar session.
 *
 * They are the same two markers `list_sessions_rich` uses to keep such rows out
 * of the session list (`_delegate_from_json(...) IS NULL`), which is why they
 * never appear in the sidebar — the descendant walk simply never applied them.
 *
 * ── A third marker: `_branched_from` ────────────────────────────────────
 *
 * `session.branch` writes `parent_session_id` **and**
 * `model_config._branched_from`, leaving the parent live and untouched. So a
 * branch is a child too, and being the newest one it wins the descendant walk:
 * open the parent from the sidebar after a fork and the chat silently swaps to
 * the branch.
 *
 * That is not a continuation, and Hermes agrees — `list_sessions_rich`
 * explicitly *whitelists* branches so parent and branch both appear as
 * top-level rows. Two peer conversations, not one conversation continued. The
 * `/model` case the resolver was written for is the opposite: the parent is
 * ended and only the child is live.
 *
 * Following a branch is therefore refused as well. Choosing to work in a new
 * branch is a decision the user makes by clicking, and the Dashboard navigates
 * there itself at that moment; it should not be re-made for them on every
 * later refresh.
 *
 * The core resolver is patched too (see Patch-HermesCore.py). This client-side
 * guard exists so the Dashboard is correct even on a Hermes that has not been
 * patched — a future release could rename the function out from under the
 * patcher, and losing the main conversation is too rough a failure to leave
 * resting on one defence.
 */

/** The fields of a session row this decision needs. */
export interface SessionLineageRow {
  id?: string;
  source?: string;
  parent_session_id?: string | null;
  /** JSON string, or an already-parsed object — the API has sent both shapes. */
  model_config?: unknown;
}

function parseModelConfig(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Is this row a sub-agent's own session?
 *
 * `_delegate_from` is written by `delegate_task` when it builds the child
 * agent, and is exactly what the session listing filters on.
 */
export function isDelegatedSession(row: SessionLineageRow | null): boolean {
  if (!row) return false;
  const config = parseModelConfig(row.model_config);
  const from = config?._delegate_from;
  return typeof from === "string" && from.trim().length > 0;
}

/** A sidecar session owned by a tool rather than by the conversation. */
export function isToolSession(row: SessionLineageRow | null): boolean {
  return row?.source === "tool";
}

/**
 * Is this row a fork the user made deliberately?
 *
 * `session.branch` records `_branched_from` and leaves the parent live, so the
 * two are peers. The session list shows both; the descendant walk should not
 * quietly pick one.
 */
export function isBranchedSession(row: SessionLineageRow | null): boolean {
  if (!row) return false;
  const from = parseModelConfig(row.model_config)?._branched_from;
  return typeof from === "string" && from.trim().length > 0;
}

/**
 * Should the chat follow the descendant chain into this session?
 *
 * No for anything that is an implementation detail of the parent — those are
 * not "the conversation continued", they are a different conversation that
 * happens to hang off it.
 */
export function mayFollowDescendant(row: SessionLineageRow | null): boolean {
  if (!row) return false;
  return (
    !isDelegatedSession(row) && !isToolSession(row) && !isBranchedSession(row)
  );
}

/** Why the chat refused to follow, in Vietnamese. Blank when it did follow. */
export function refusedFollowReasonVi(row: SessionLineageRow | null): string {
  if (!row) return "";
  if (isDelegatedSession(row)) return "phiên riêng của một agent phụ";
  if (isToolSession(row)) return "phiên phụ do một công cụ tạo";
  if (isBranchedSession(row)) return "một nhánh anh tự tách ra";
  return "";
}
