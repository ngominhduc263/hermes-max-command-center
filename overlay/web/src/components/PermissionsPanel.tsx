import { Button } from "@nous-research/ui/ui/components/button";
import {
  Ban,
  Check,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import {
  addDenyRule,
  approvalMode,
  APPROVAL_MODE_VI,
  buildConfigPatch,
  denyRules,
  denyRuleWarning,
  grantedPermissions,
  normalizeDenyRule,
  rawAllowlist,
  removeDenyRule,
  revokePermission,
  RISK_VI,
  type ApprovalMode,
  type PermissionEntry,
} from "@/lib/hermes-permissions";
import { cn } from "@/lib/utils";

/**
 * "Quyền & phê duyệt" — see, and take back, what Hermes has been allowed to do.
 *
 * Pressing "always" at an approval prompt writes into `command_allowlist` in
 * config.yaml and there is no undo anywhere in the product: the only way back
 * was `hermes config edit`. This panel is that undo, plus the two neighbouring
 * settings that decide whether the prompt appears at all (`approvals.mode`)
 * and what can never run regardless (`approvals.deny`).
 *
 * All three are read from `GET /api/config` and written with `PUT /api/config`,
 * which deep-merges over what is on disk and replaces lists wholesale — so a
 * patch carrying one key cannot disturb the rest of the user's config.
 */

interface PermissionsPanelProps {
  profile?: string;
  onClose: () => void;
  /** Notified after a successful save, so a caller's summary can re-read. */
  onSaved?: () => void;
}

type Loaded = {
  allowlist: string[];
  deny: string[];
  mode: ApprovalMode;
};

export function PermissionsPanel({
  profile,
  onClose,
  onSaved,
}: PermissionsPanelProps) {
  const [state, setState] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [draftRule, setDraftRule] = useState("");
  // A revoke is one click away from being irreversible for the user's
  // security posture, so the destructive ones ask once.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Promise chaining rather than async/await: every setState then sits in a
  // callback instead of the function body, which is what keeps the mounting
  // effect below off React's cascading-render path.
  const load = useCallback(
    () =>
      api
        .getConfig(profile)
        .then((config) => {
          setState({
            allowlist: rawAllowlist(config),
            deny: denyRules(config),
            mode: approvalMode(config),
          });
          setLoadError("");
        })
        .catch((error: unknown) => {
          setLoadError(
            error instanceof Error ? error.message : "không đọc được cấu hình",
          );
        }),
    [profile],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Save a change and keep the panel honest about what is on disk: re-read
   * rather than trusting the optimistic copy, so a write the backend adjusted
   * (or refused) is visible immediately.
   */
  const commit = useCallback(
    async (next: Partial<Loaded>, message: string) => {
      if (!state || saving) return;
      setSaving(true);
      setNote("");
      try {
        await api.saveConfig(
          buildConfigPatch({
            allowlist: next.allowlist,
            deny: next.deny,
            mode: next.mode,
          }),
          profile,
        );
        await load();
        setNote(message);
        onSaved?.();
      } catch (error) {
        setNote(
          `Chưa lưu được: ${
            error instanceof Error ? error.message : "lỗi không rõ"
          }`,
        );
      } finally {
        setSaving(false);
        setConfirming(null);
      }
    },
    [load, onSaved, profile, saving, state],
  );

  const granted = useMemo(
    () => grantedPermissions({ command_allowlist: state?.allowlist ?? [] }),
    [state?.allowlist],
  );

  const revoke = useCallback(
    (entry: PermissionEntry) =>
      void commit(
        { allowlist: revokePermission(state?.allowlist ?? [], entry.key) },
        "Đã thu hồi — gõ /new để phiên đang chạy dùng danh sách mới.",
      ),
    [commit, state?.allowlist],
  );

  const draftWarning = denyRuleWarning(draftRule);
  const draftRuleReady =
    !!normalizeDenyRule(draftRule) &&
    !(state?.deny ?? []).some(
      (rule) =>
        rule.toLowerCase() === normalizeDenyRule(draftRule).toLowerCase(),
    );

  return (
    <div
      className="hermes-permissions"
      role="dialog"
      aria-label="Quyền và phê duyệt"
    >
      <header>
        <div>
          <strong>
            <ShieldCheck className="h-4 w-4" /> Quyền &amp; phê duyệt
          </strong>
          <span>
            Những gì anh đã cho phép Hermes làm mà không hỏi lại — xem và thu
            hồi ngay tại đây.
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng bảng quyền">
          <X className="h-4 w-4" />
        </button>
      </header>

      {loadError ? (
        <div className="hermes-permissions-error">
          <TriangleAlert className="h-4 w-4" />
          <span>Không đọc được cấu hình Hermes ({loadError}).</span>
          <Button size="sm" outlined onClick={() => void load()}>
            Thử lại
          </Button>
        </div>
      ) : !state ? (
        <p className="hermes-permissions-loading">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Đang đọc cấu hình…
        </p>
      ) : (
        <div className="hermes-permissions-body">
          <section>
            <h3>
              Khi gặp lệnh nguy hiểm
              <em>{granted.length ? `${granted.length} quyền đã cấp` : ""}</em>
            </h3>
            <div className="hermes-permissions-modes">
              {APPROVAL_MODE_VI.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  disabled={saving}
                  aria-pressed={state.mode === option.mode}
                  className={cn(
                    state.mode === option.mode && "is-active",
                    option.mode === "off" && "is-risky",
                  )}
                  onClick={() =>
                    void commit(
                      { mode: option.mode },
                      `Đã chuyển sang chế độ "${option.label}".`,
                    )
                  }
                >
                  <span>
                    {state.mode === option.mode ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : null}
                    {option.label}
                  </span>
                  <em>{option.vi}</em>
                </button>
              ))}
            </div>
            {state.mode === "off" ? (
              <p className="hermes-permissions-warn">
                <TriangleAlert className="h-3.5 w-3.5" />
                Đang tắt hỏi duyệt — Hermes chạy mọi lệnh, kể cả xoá thư mục,
                mà không dừng lại lần nào.
              </p>
            ) : state.mode === "smart" ? (
              // The most common "tôi thu hồi rồi mà sao vẫn không hỏi": in
              // smart mode a guard model rates each command, and a delete it
              // judges harmless never reaches the prompt at all.
              <p className="hermes-permissions-hint">
                Ở chế độ này Hermes nhờ một mô hình phụ chấm điểm từng lệnh, nên
                thu hồi quyền rồi vẫn có thể <strong>không thấy hỏi</strong> —
                nếu mô hình đó cho rằng lệnh vô hại. Muốn chắc chắn lần nào cũng
                được hỏi thì chọn <strong>Hỏi mọi lúc</strong>; muốn cấm hẳn thì
                dùng mục <strong>Cấm tuyệt đối</strong> bên dưới.
              </p>
            ) : null}
          </section>

          <section>
            <h3>
              Quyền đã cấp vĩnh viễn
              {granted.length ? (
                <Button
                  size="sm"
                  ghost
                  disabled={saving}
                  onClick={() =>
                    void commit(
                      { allowlist: [] },
                      "Đã thu hồi toàn bộ. Hermes sẽ hỏi lại từ đầu.",
                    )
                  }
                  prefix={<RotateCcw className="h-3.5 w-3.5" />}
                >
                  Thu hồi tất cả
                </Button>
              ) : null}
            </h3>

            {granted.length ? (
              <ul className="hermes-permissions-list">
                {granted.map((entry) => (
                  <li key={entry.key} className={`is-${entry.risk}`}>
                    <div>
                      <span className="hermes-permissions-risk">
                        {RISK_VI[entry.risk]}
                      </span>
                      <p>{entry.vi}</p>
                      <code>{entry.key}</code>
                    </div>
                    {confirming === entry.key ? (
                      <div className="hermes-permissions-confirm">
                        <Button
                          size="sm"
                          disabled={saving}
                          onClick={() => revoke(entry)}
                        >
                          Thu hồi
                        </Button>
                        <Button
                          size="sm"
                          ghost
                          onClick={() => setConfirming(null)}
                        >
                          Thôi
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        outlined
                        disabled={saving}
                        onClick={() => setConfirming(entry.key)}
                      >
                        Thu hồi
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hermes-permissions-empty">
                Chưa cấp quyền vĩnh viễn nào. Mỗi lần gặp lệnh nguy hiểm Hermes
                đều sẽ hỏi anh.
              </p>
            )}
          </section>

          <section>
            <h3>
              Cấm tuyệt đối
              <em>mạnh hơn mọi thứ khác</em>
            </h3>
            <p className="hermes-permissions-hint">
              Lệnh khớp mẫu ở đây sẽ bị chặn kể cả khi anh lỡ bấm “luôn cho
              phép”, kể cả khi bật <code>/yolo</code> hay tắt hỏi duyệt. Dùng
              dấu <code>*</code> để khớp phần còn lại của lệnh.
            </p>

            {state.deny.length ? (
              <ul className="hermes-permissions-deny">
                {state.deny.map((rule) => (
                  <li key={rule}>
                    <Ban className="h-3.5 w-3.5" />
                    <code>{rule}</code>
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Bỏ luật chặn ${rule}`}
                      onClick={() =>
                        void commit(
                          { deny: removeDenyRule(state.deny, rule) },
                          `Đã bỏ luật chặn "${rule}".`,
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="hermes-permissions-add">
              <Ban className="h-3.5 w-3.5" />
              <input
                value={draftRule}
                onChange={(event) => setDraftRule(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && draftRuleReady) {
                    event.preventDefault();
                    void commit(
                      { deny: addDenyRule(state.deny, draftRule) },
                      `Đã chặn "${normalizeDenyRule(draftRule)}".`,
                    );
                    setDraftRule("");
                  }
                }}
                placeholder="Ví dụ: rm -rf *"
                disabled={saving}
              />
              <Button
                size="sm"
                disabled={saving || !draftRuleReady}
                prefix={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  void commit(
                    { deny: addDenyRule(state.deny, draftRule) },
                    `Đã chặn "${normalizeDenyRule(draftRule)}".`,
                  );
                  setDraftRule("");
                }}
              >
                Chặn
              </Button>
            </label>

            {draftWarning ? (
              <p className="hermes-permissions-warn">
                <TriangleAlert className="h-3.5 w-3.5" />
                {draftWarning}
              </p>
            ) : null}
          </section>

          <footer>
            {saving ? (
              <span>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Đang
                lưu…
              </span>
            ) : note ? (
              <span>{note}</span>
            ) : (
              <span>
                Thay đổi lưu thẳng vào config.yaml. Phiên đang chạy giữ bản sao
                cũ trong bộ nhớ, nên hãy <code>/new</code> để nó đọc lại danh
                sách mới.
              </span>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}
