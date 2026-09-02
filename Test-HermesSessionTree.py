"""Chứng minh Dashboard không còn nhảy vào phiên riêng của agent phụ.

Lỗi gốc nằm ở `hermes_cli/web_server.py::_session_latest_descendant`: nó chạy
một truy vấn đệ quy đi xuống MỌI phiên con theo `parent_session_id`, sắp theo
`started_at` rồi lấy con mới nhất — không lọc gì cả. Chú thích của chính hàm đó
nói rõ mục đích là đi theo phiên nối tiếp khi `/model` đổi model.

Nhưng phiên của một agent phụ cũng là con. Ngay sau một lô delegation thì nó là
con MỚI NHẤT, nên Dashboard đổi `?resume=` sang bản ghi riêng của agent phụ và
cuộc trò chuyện thật biến mất khỏi khung chat — trong khi tab Terminal, đọc
thẳng PTY, vẫn hiện đầy đủ. Hai mặt của "cùng một phiên" mà nội dung khác hẳn.

Bài kiểm này dựng đúng hình đó trong SQLite rồi chạy chính truy vấn nằm trong
web_server.py: phải đi theo con nối tiếp, và phải bỏ qua con của agent phụ.

Chạy:  python Test-HermesSessionTree.py <đường-dẫn-repo-hermes>
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"HERMES_TREE_FAIL: {message}")
    raise SystemExit(1)


def extract_query(repo: Path) -> str:
    """Lấy đúng truy vấn đệ quy đang nằm trong web_server.py."""

    path = repo / "hermes_cli" / "web_server.py"
    if not path.is_file():
        fail("khong thay hermes_cli/web_server.py")
    source = path.read_text(encoding="utf-8")

    match = re.search(
        r"(WITH RECURSIVE descendants\(id, parent_session_id, started_at\).*?"
        r"SELECT id, parent_session_id, started_at FROM descendants)",
        source,
        re.S,
    )
    if not match:
        fail("khong nhan ra truy van de quy trong _session_latest_descendant")
    return match.group(1)


def newest_leaf(conn: sqlite3.Connection, query: str, root: str) -> str:
    """Chạy đúng vòng lặp mà web_server.py chạy sau truy vấn."""

    rows = [dict(row) for row in conn.execute(query, (root,)).fetchall()]

    children: dict[str, list[dict]] = {}
    for row in rows:
        parent = row.get("parent_session_id")
        if row.get("id") and parent:
            children.setdefault(parent, []).append(row)

    current, seen = root, {root}
    while children.get(current):
        candidates = [r for r in children[current] if r["id"] not in seen]
        if not candidates:
            break
        candidates.sort(key=lambda r: float(r.get("started_at") or 0), reverse=True)
        current = candidates[0]["id"]
        seen.add(current)
    return current


def build(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, "
        "started_at REAL, source TEXT, model_config TEXT)"
    )
    rows = [
        # Phiên chính người dùng đang trò chuyện.
        ("main", None, 1000.0, "tui", None),
        # Con nối tiếp do /model tạo — ĐÚNG mục đích của hàm, phải đi theo.
        ("model-switch", "main", 1100.0, "tui", json.dumps({"_model_switch": True})),
        # Ba phiên agent phụ, tạo SAU cùng: đây chính là bẫy. Không lọc thì
        # chúng luôn thắng vì mới nhất.
        ("sub-0", "main", 1200.0, "tui", json.dumps({"_delegate_from": "main"})),
        ("sub-1", "main", 1201.0, "tui", json.dumps({"_delegate_from": "main"})),
        ("sub-2", "model-switch", 1300.0, "tui", json.dumps({"_delegate_from": "main"})),
        # Phiên phụ do một công cụ tạo, cũng phải bỏ qua.
        ("tool-side", "main", 1400.0, "tool", None),
        # Nhánh do session.branch tạo, MỚI NHẤT trong cả cây. Nhánh để phiên
        # gốc sống nguyên và list_sessions_rich() hiện cả hai như hai dòng
        # ngang hàng — nhảy sang nó là cướp mất phiên người dùng đang mở.
        ("branch-1", "main", 1500.0, "tui", json.dumps({"_branched_from": "main"})),
    ]
    conn.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", rows)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    repo = Path(args[0] if args else ".").resolve()
    if not (repo / "agent").is_dir():
        fail(f"khong tim thay repo Hermes tai: {repo}")

    query = extract_query(repo)

    conn = sqlite3.connect(":memory:")
    build(conn)

    landed = newest_leaf(conn, query, "main")

    if landed in {"sub-0", "sub-1", "sub-2"}:
        fail(
            f"van nhay vao phien cua agent phu ({landed}) — "
            "cuoc tro chuyen chinh se bien mat khoi khung chat"
        )
    if landed == "tool-side":
        fail("van nhay vao phien phu do cong cu tao (tool-side)")
    if landed == "branch-1":
        fail(
            "van nhay vao nhanh nguoi dung tu tach (branch-1) — "
            "mo phien goc ma bi doi sang nhanh"
        )
    if landed != "model-switch":
        fail(
            f"khong di theo phien noi tiep khi doi model: dung o '{landed}', "
            "mong doi 'model-switch'"
        )

    # Gốc không có con hợp lệ thì phải đứng yên, chứ không rơi vào agent phụ.
    conn.execute("DELETE FROM sessions WHERE id = 'model-switch'")
    if newest_leaf(conn, query, "main") != "main":
        fail("khong con con hop le ma van roi vao mot phien con khac")

    print(
        "HERMES_TREE_PASS: di theo phien noi tiep, bo qua phien agent phu, "
        "phien cong cu va nhanh tu tach"
    )


if __name__ == "__main__":
    main()
