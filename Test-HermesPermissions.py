#!/usr/bin/env python3
"""Kiểm tra: thu hồi quyền trên Dashboard có thật sự có hiệu lực không.

Bảng "Quyền & phê duyệt" ghi vào `command_allowlist` trong config.yaml. Nhưng
tiến trình Hermes đang chạy giữ một bản sao trong bộ nhớ (`_permanent_approved`
trong tools/approval.py). Bản gốc của Hermes nạp danh sách đó bằng phép HỢP —
nghĩa là quyền bị gỡ khỏi config vẫn còn sống trong bộ nhớ tới khi tắt hẳn
Hermes, và lần bấm "luôn cho phép" kế tiếp sẽ ghi ngược bản cũ ra đĩa, âm thầm
huỷ luôn thao tác thu hồi.

Overlay sửa `load_permanent()` thành phép THAY THẾ. File này chứng minh điều đó
trên đúng bản Hermes của anh:

    python Test-HermesPermissions.py "D:\\HERMES AGENT\\hermes-agent"

1. Quyền bị gỡ khỏi config thì mất hiệu lực sau khi nạp lại (`/new`).
2. Gỡ TOÀN BỘ cũng có hiệu lực — đây là trường hợp bản gốc bỏ sót, vì nó chỉ
   nạp lại khi danh sách khác rỗng.
3. Quyền còn trong config thì KHÔNG bị mất — thu hồi phải đúng cái được chọn.
4. Quyền vừa cấp sống sót qua chính vòng lưu–nạp của nó.

In HERMES_PERM_PASS và thoát 0 nếu đạt; in lý do và thoát 1 nếu hỏng.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

KEY_REVOKED = "recursive delete"
KEY_KEPT = "SQL DROP"
KEY_NEW = "git reset --hard (destroys uncommitted changes)"


def fail(message: str) -> None:
    """Báo hỏng — installer đọc để BÁO CÁO, không để huỷ bản cài.

    Không vá được thì thu hồi quyền chỉ có hiệu lực sau khi TẮT HẲN
    Hermes rồi mở lại, thay vì chỉ cần /new. Phiền, nhưng không phải
    lý do để bỏ luôn bản Dashboard vừa build xong.
    """
    print(f"HERMES_PERM_FAIL: {message}")
    print("  (thu hoi quyen van an sau khi TAT HAN Hermes roi mo lai)")
    raise SystemExit(1)


def write_allowlist(home: Path, keys: list[str]) -> None:
    body = "command_allowlist: []\n"
    if keys:
        body = "command_allowlist:\n" + "".join(f"  - {key}\n" for key in keys)
    (home / "config.yaml").write_text(body, encoding="utf-8")


def main() -> None:
    repo = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not (repo / "tools" / "approval.py").is_file():
        fail(f"khong tim thay repo Hermes tai: {repo}")

    # A throwaway HERMES_HOME: this must never touch the user's real config.
    with tempfile.TemporaryDirectory(prefix="hermes-perm-check-") as tmp:
        home = Path(tmp)
        os.environ["HERMES_HOME"] = str(home)
        sys.path.insert(0, str(repo))

        write_allowlist(home, [KEY_REVOKED, KEY_KEPT])
        try:
            from tools import approval
        except Exception as exc:  # noqa: BLE001
            fail(f"khong import duoc tools.approval: {exc}")

        approval.load_permanent_allowlist()
        if not approval.is_approved("s", KEY_REVOKED):
            fail("moi nap tu config ma quyen da khong co hieu luc — sai co ban")

        # 1 + 3: revoke one, keep the other.
        write_allowlist(home, [KEY_KEPT])
        approval.load_permanent_allowlist()
        if approval.is_approved("s", KEY_REVOKED):
            fail(
                "thu hoi khong an: quyen da go khoi config van con hieu luc sau "
                "khi nap lai (load_permanent dang HOP thay vi THAY THE)"
            )
        if not approval.is_approved("s", KEY_KEPT):
            fail("thu hoi qua tay: quyen VAN CON trong config lai bi mat")

        # 2: revoking the last one is the case a truthiness check skips.
        write_allowlist(home, [])
        approval.load_permanent_allowlist()
        if approval.is_approved("s", KEY_KEPT):
            fail(
                "go toan bo khong an: danh sach rong bi bo qua khi nap lai "
                "(load_permanent_allowlist can goi load_permanent vo dieu kien)"
            )

        # 4: a grant made now must survive its own save + reload.
        approval.approve_permanent(KEY_NEW)
        approval.save_permanent_allowlist(approval._permanent_approved)
        approval.load_permanent_allowlist()
        if not approval.is_approved("s", KEY_NEW):
            fail("quyen vua cap khong song sot qua vong luu-nap cua chinh no")

        on_disk = (home / "config.yaml").read_text(encoding="utf-8")
        if KEY_REVOKED in on_disk:
            fail("quyen da thu hoi bi ghi nguoc ra config sau mot lan cap quyen moi")

    print("HERMES_PERM_PASS: thu hoi quyen co hieu luc sau /new, khong lam mat quyen khac")


if __name__ == "__main__":
    main()
