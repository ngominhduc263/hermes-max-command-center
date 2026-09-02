/**
 * Changing the model a room member speaks with.
 *
 * ── What the runtime actually allows ────────────────────────────────────
 *
 * A hosted-room member is `{member_id, profile, handle}` and **nothing else**.
 * The roster validator (`gateway/hosted_room_discussion.py::_exact_fields`)
 * rejects any extra key outright, and the `hosted_rooms` table has no model
 * column — so there is no such thing as "this bot's model *in this room*".
 * None of the 18 `groups.*` RPCs mentions a model.
 *
 * The model comes from the member profile's own `config.yaml`: the room driver
 * creates the member session with **no model override**
 * (`hosted_room_server_rpc.py`: "Create a session without model or provider
 * overrides"), so `_resolve_model()` falls through to `model.default` /
 * `model.provider` in that profile's config.
 *
 * The supported way to write those two keys is
 * `PUT /api/profiles/{name}/model {provider, model}`, which is exactly what
 * `api.setProfileModel` calls.
 *
 * ── The consequence the UI must not hide ────────────────────────────────
 *
 * That write is **global to the profile**. The same bot answers in every other
 * room, and in its own chats, with the new model. There is no room-scoped
 * variant to offer instead, so the panel says this in words before the click
 * rather than presenting a per-room illusion.
 *
 * (A room-scoped pin is *technically* reachable by resuming the member's hidden
 * `Group: <room_id>` session and calling `config.set` with a `session_id`. It
 * is deliberately not used here: it lasts only until the gateway restarts —
 * `_stored_session_runtime_overrides` returns `{}` for room-plumbing rows on
 * purpose, so they "always rebuild from the member profile's CURRENT config" —
 * and a setting that silently reverts is worse than one with an honest scope.)
 *
 * ── When it takes effect ────────────────────────────────────────────────
 *
 * On that member's **next turn**, with no restart. The member session is
 * persistent (`Group: <room_id>`, resumed each turn), but every turn begins
 * with `_sync_agent_model_with_config`, which re-reads `model.default` and
 * hot-swaps the live agent. So the change lands mid-room, not "next time".
 */

/** A model the picker can offer. Mirrors `FavoriteModel` from the chat picker. */
export interface ModelChoice {
  id: string;
  provider?: string;
}

/** Why a model cannot be applied yet, in Vietnamese, or "" when it can. */
export function modelProblemVi(
  choice: ModelChoice | null,
  currentModel: string,
): string {
  if (!choice) return "Chưa chọn model.";
  if (!choice.id.trim()) return "Model không hợp lệ.";
  // `/api/profiles/{name}/model` requires both halves: the provider decides
  // which credentials and base URL the model is reached through, and the
  // endpoint rejects a bare model id.
  if (!choice.provider?.trim()) {
    return "Model này không kèm provider — chọn từ danh sách để có đủ hai phần.";
  }
  if (sameModelId(choice.id, currentModel)) return "Đang dùng model này rồi.";
  return "";
}

/** Model ids differing only by case or padding are the same model. */
export function sameModelId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The sentence shown before the click.
 *
 * Names the other places the change reaches, because the picker sits inside
 * one room and would otherwise read as a per-room setting.
 */
export function scopeWarningVi(handle: string, roomCount: number): string {
  const others = Math.max(0, roomCount - 1);
  const elsewhere =
    others > 0
      ? `${others} phòng khác và cả khi nhắn riêng`
      : "cả khi nhắn riêng";
  return `Đổi model của @${handle} là đổi cho chính profile đó — áp dụng luôn ở ${elsewhere}. Hermes không có model riêng theo từng phòng.`;
}

/** Params for `api.setProfileModel`, or null when the choice is unusable. */
export function buildModelUpdate(
  profile: string,
  choice: ModelChoice | null,
): { name: string; provider: string; model: string } | null {
  const name = profile.trim();
  const model = choice?.id.trim() ?? "";
  const provider = choice?.provider?.trim() ?? "";
  if (!name || !model || !provider) return null;
  return { model, name, provider };
}

/** What the member row shows once a change has been asked for. */
export function applyStateVi(
  state: "idle" | "saving" | "done" | "failed",
  model: string,
): string {
  switch (state) {
    case "saving":
      return "Đang đổi…";
    case "done":
      // Deliberately not "đã đổi xong": the running turn keeps its old model,
      // the swap happens when this member next speaks.
      return `Đã đặt ${model} — áp dụng từ lượt nói kế tiếp.`;
    case "failed":
      return "Không đổi được model.";
    default:
      return "";
  }
}
