#!/usr/bin/env python3
"""Vá tại chỗ ba thứ trong lõi Hermes, thay vì ghi đè cả file.

    python Patch-HermesCore.py "D:\\HERMES AGENT\\hermes-agent"
    python Patch-HermesCore.py "D:\\HERMES AGENT\\hermes-agent" --check

VÌ SAO KHÔNG GHI ĐÈ CẢ FILE. Các bản trước của gói này chép đè nguyên
`agent/i18n.py` và `tools/approval.py` từ bản Hermes v0.20.6. Anh chạy
`hermes update` lên bản mới hơn là bản cài kéo ngược hai file đó về v0.20.6 —
với `tools/approval.py` thì đó là **hạ cấp bộ dò lệnh nguy hiểm**, mất luôn
những mẫu nguy hiểm mà bản mới vừa bổ sung. Không đáng để đổi lấy một thay đổi
mười dòng.

Nên giờ sửa tại chỗ, và mỗi bước tự lo cho mình:

  A. Đăng ký "vi" vào SUPPORTED_LANGUAGES + bảng alias (agent/i18n.py).
  B. Sửa lỗi thu hồi quyền: nạp lại danh sách quyền là THAY THẾ chứ không HỢP
     (tools/approval.py).
  C. Bù các khoá dịch còn thiếu trong locales/vi.yaml theo en.yaml của chính
     bản Hermes này.

Cả ba đều **idempotent** (chạy lại là không làm gì thêm) và **không phá** khi
mã nguồn đã đổi: không nhận ra đoạn cần sửa thì bỏ qua kèm cảnh báo, chứ không
đoán mò. Bỏ qua không làm hỏng bản cài — chỉ mất đúng tính năng đó.

Thoát 0 nếu chạy được (kể cả có bước bị bỏ qua); thoát 1 nếu không đọc/ghi
được file.
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

APPLIED = "đã vá"
ALREADY = "đã có sẵn"


class Skip(Exception):
    """Đoạn mã cần sửa không còn như cũ — bỏ qua thay vì đoán."""


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    # newline="" so the file keeps LF endings on Windows too — Python source
    # and YAML both read fine either way, but rewriting a whole file's line
    # endings makes a needlessly enormous diff against upstream.
    with io.open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


# ── A. Đăng ký tiếng Việt ────────────────────────────────────────────────

VI_ALIASES = '''    # Vietnamese — endonym with and without diacritics, since a config file
    # typed on a non-Vietnamese keyboard often loses them.
    "vietnamese": "vi", "tiếng việt": "vi", "tieng viet": "vi",
    "vietnam": "vi", "việt": "vi", "viet": "vi", "vi-vn": "vi",
'''


def register_vietnamese(repo: Path, check: bool) -> str:
    path = repo / "agent" / "i18n.py"
    if not path.is_file():
        raise Skip("không thấy agent/i18n.py")
    source = read(path)

    languages = re.search(
        r"(SUPPORTED_LANGUAGES\s*:\s*tuple\[str, \.\.\.\]\s*=\s*\()(.*?)(\n\))",
        source,
        re.S,
    )
    if not languages:
        raise Skip("không nhận ra SUPPORTED_LANGUAGES")

    aliases = re.search(
        r"(_LANGUAGE_ALIASES\s*:\s*dict\[str, str\]\s*=\s*\{)(.*?)(\n\})",
        source,
        re.S,
    )
    if not aliases:
        raise Skip("không nhận ra _LANGUAGE_ALIASES")

    has_language = '"vi"' in languages.group(2)
    has_aliases = '"vietnamese"' in aliases.group(2)
    if has_language and has_aliases:
        return ALREADY
    if check:
        return "CHƯA vá"

    patched = source
    if not has_language:
        patched = (
            patched[: languages.start()]
            + languages.group(1)
            + languages.group(2).rstrip().rstrip(",")
            + ', "vi",'
            + languages.group(3)
            + patched[languages.end() :]
        )
        # Offsets moved; re-find the alias block in the patched text.
        aliases = re.search(
            r"(_LANGUAGE_ALIASES\s*:\s*dict\[str, str\]\s*=\s*\{)(.*?)(\n\})",
            patched,
            re.S,
        )
        if not aliases:
            raise Skip("không nhận ra _LANGUAGE_ALIASES sau khi sửa")

    if not has_aliases:
        body = aliases.group(2)
        if not body.rstrip().endswith(","):
            body = body.rstrip() + ","
        patched = (
            patched[: aliases.start()]
            + aliases.group(1)
            + body
            + "\n"
            + VI_ALIASES.rstrip("\n")
            + aliases.group(3)
            + patched[aliases.end() :]
        )

    write(path, patched)
    return APPLIED


# ── B. Sửa lỗi thu hồi quyền ─────────────────────────────────────────────

RELOAD_NOTE = """        # Vá bởi Hermes Max: THAY THẾ chứ không HỢP. config.yaml là nguồn
        # sự thật, tập này chỉ là bản đệm của nó — hợp lại thì quyền đã gỡ
        # khỏi config vẫn sống trong tiến trình đang chạy, và lần "luôn cho
        # phép" kế tiếp ghi ngược bản cũ ra đĩa, âm thầm huỷ thao tác thu hồi.
        _permanent_approved.clear()
"""


def fix_permission_reload(repo: Path, check: bool) -> str:
    path = repo / "tools" / "approval.py"
    if not path.is_file():
        raise Skip("không thấy tools/approval.py")
    source = read(path)

    block = re.search(
        r"def load_permanent\(patterns: set\):.*?(?=\ndef |\nclass |\Z)",
        source,
        re.S,
    )
    if not block:
        raise Skip("không nhận ra load_permanent()")

    body = block.group(0)
    reload_done = "_permanent_approved.clear()" in body

    guard = re.search(
        r"\n(\s*)if patterns:\n\s*load_permanent\(patterns\)\n",
        source,
    )
    guard_done = guard is None and "load_permanent(patterns)" in source

    if reload_done and guard_done:
        return ALREADY
    if check:
        return "CHƯA vá"

    patched = source
    if not reload_done:
        if "_permanent_approved.update(patterns)" not in body:
            raise Skip("load_permanent() không còn dùng update(patterns)")
        new_body = body.replace(
            "        _permanent_approved.update(patterns)",
            RELOAD_NOTE + "        _permanent_approved.update(patterns)",
            1,
        )
        patched = patched[: block.start()] + new_body + patched[block.end() :]

    # Reloading an EMPTY list is exactly the revoke-everything case, and the
    # truthiness guard skips it.
    guard = re.search(
        r"\n(\s*)if patterns:\n\s*load_permanent\(patterns\)\n",
        patched,
    )
    if guard:
        indent = guard.group(1)
        patched = (
            patched[: guard.start()]
            + f"\n{indent}load_permanent(patterns)\n"
            + patched[guard.end() :]
        )

    write(path, patched)
    return APPLIED


# ── C. Bù khoá dịch còn thiếu ────────────────────────────────────────────


def flatten(node, prefix: str = "") -> dict:
    out = {}
    for key, value in (node or {}).items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def merge_tree(english, vietnamese):
    """en's shape and order, vi's text where it has any."""
    merged = {}
    for key, value in (english or {}).items():
        mine = (vietnamese or {}).get(key)
        if isinstance(value, dict):
            merged[key] = merge_tree(value, mine if isinstance(mine, dict) else {})
        else:
            merged[key] = mine if isinstance(mine, str) else value
    return merged


def fill_locale_gaps(repo: Path, check: bool) -> str:
    locales = repo / "locales"
    english_path, vi_path = locales / "en.yaml", locales / "vi.yaml"
    if not english_path.is_file():
        raise Skip("không thấy locales/en.yaml")
    if not vi_path.is_file():
        raise Skip("không thấy locales/vi.yaml")

    try:
        import yaml
    except ImportError:
        raise Skip("python này không có pyyaml")

    english = yaml.safe_load(read(english_path)) or {}
    vietnamese = yaml.safe_load(read(vi_path)) or {}

    english_keys = set(flatten(english))
    vi_keys = set(flatten(vietnamese))
    missing = sorted(english_keys - vi_keys)
    extra = sorted(vi_keys - english_keys)

    if not missing and not extra:
        return ALREADY
    if check:
        return f"CHƯA đồng bộ ({len(missing)} thiếu, {len(extra)} thừa)"

    merged = merge_tree(english, vietnamese)
    header = (
        "# Hermes static-message catalog -- Vietnamese (Tiếng Việt)\n"
        "#\n"
        "# File này vừa được Patch-HermesCore.py đồng bộ lại theo en.yaml của\n"
        "# chính bản Hermes đang cài, nên tập khoá khớp 100%. Khoá nào gói\n"
        "# chưa dịch thì tạm giữ nguyên câu tiếng Anh — hiển thị y như khi\n"
        "# chưa cài gói, và sẽ được dịch ở bản cập nhật sau.\n"
        "#\n"
        f"# Bổ sung {len(missing)} khoá mới, bỏ {len(extra)} khoá không còn dùng.\n"
        "\n"
    )
    write(
        vi_path,
        header
        + yaml.safe_dump(
            merged, allow_unicode=True, default_flow_style=False, sort_keys=False
        ),
    )

    parts = []
    if missing:
        parts.append(f"bổ sung {len(missing)} khoá (tạm tiếng Anh)")
    if extra:
        parts.append(f"bỏ {len(extra)} khoá thừa")
    detail = ", ".join(parts)
    if missing:
        preview = ", ".join(missing[:4]) + ("…" if len(missing) > 4 else "")
        detail += f" — {preview}"
    return f"{APPLIED}: {detail}"



# ── D. Không đi lạc vào phiên của agent phụ ──────────────────────────────

DESCENDANT_MARKER = "-- Hermes Max: đừng đi xuống phiên con"

DESCENDANT_NOTE = """\
            -- Hermes Max: đừng đi xuống phiên con của agent phụ, của công cụ,
            -- hay của một nhánh người dùng tự tách. Hàm này sinh ra để đi theo
            -- phiên nối tiếp khi đổi model (xem chú thích ở trên), nhưng:
            --
            --   _delegate_from : phiên riêng của agent phụ. Ngay sau một lô
            --     delegation thì nó là con MỚI NHẤT, nên Dashboard nhảy vào bản
            --     ghi của agent phụ và cuộc trò chuyện thật biến mất.
            --   source = 'tool' : phiên phụ do công cụ tạo.
            --   _branched_from : nhánh do session.branch tạo. Nhánh để phiên
            --     gốc SỐNG NGUYÊN và list_sessions_rich() cố ý hiện cả hai như
            --     hai dòng ngang hàng — tức là hai cuộc trò chuyện song song,
            --     không phải một cuộc được nối tiếp. Mở phiên gốc mà bị nhảy
            --     sang nhánh là đúng con lỗi ở trên, chỉ khác nguyên nhân.
            --
            -- Hai dấu đầu đúng là những dấu list_sessions_rich() dùng để giấu
            -- các phiên đó khỏi danh sách.
"""

DESCENDANT_FILTER = (
    "                WHERE json_extract("
    "COALESCE(s.model_config, '{}'), '$._delegate_from') IS NULL\n"
    "                  AND json_extract("
    "COALESCE(s.model_config, '{}'), '$._branched_from') IS NULL\n"
    "                  AND COALESCE(s.source, '') != 'tool'\n"
)


# Dò theo NỘI DUNG bộ lọc, không theo dấu mốc trong chú thích. Bản v2.28.0
# lọc hai điều kiện; v2.29.0 thêm điều kiện thứ ba (_branched_from). Nếu chỉ
# nhìn dấu mốc thì máy đã cài v2.28.0 sẽ báo "đã có sẵn" và không bao giờ nhận
# được điều kiện mới — nâng cấp im lặng thành không làm gì.
DELEGATE_CLAUSE = "'$._delegate_from') IS NULL"
BRANCH_CLAUSE = "'$._branched_from') IS NULL"

BRANCH_UPGRADE_LINE = (
    "                  AND json_extract("
    "COALESCE(s.model_config, '{}'), '$._branched_from') IS NULL\n"
)


def fix_descendant_walk(repo: Path, check: bool) -> str:
    """`_session_latest_descendant` đi xuống MỌI phiên con, không lọc gì."""

    path = repo / "hermes_cli" / "web_server.py"
    if not path.is_file():
        raise Skip("không thấy hermes_cli/web_server.py")
    source = read(path)

    has_delegate = DELEGATE_CLAUSE in source
    has_branch = BRANCH_CLAUSE in source

    if has_delegate and has_branch:
        return ALREADY

    # Nâng cấp từ bản vá cũ: chỉ thiếu đúng điều kiện nhánh.
    if has_delegate and not has_branch:
        if check:
            return "CHƯA đủ (thiếu lọc nhánh)"
        anchor = [
            line
            for line in source.splitlines(keepends=True)
            if DELEGATE_CLAUSE in line
        ]
        if len(anchor) != 1:
            raise Skip("không nhận ra dòng lọc _delegate_from để bổ sung")
        patched = source.replace(anchor[0], anchor[0] + BRANCH_UPGRADE_LINE, 1)
        write(path, patched)
        return f"{APPLIED}: bổ sung lọc nhánh tự tách"

    join = "                JOIN descendants d ON s.parent_session_id = d.id\n"
    if source.count(join) != 1:
        raise Skip("không nhận ra truy vấn đệ quy trong _session_latest_descendant")
    if check:
        return "CHƯA vá"

    patched = source.replace(join, join + DESCENDANT_NOTE + DESCENDANT_FILTER, 1)
    write(path, patched)
    return APPLIED


# ── E. Đăng ký tiếng Việt cho Dashboard ──────────────────────────────────
#
# Hai file này TRƯỚC ĐÂY bị chép đè cả file, và đó là đúng con lỗi mà cả
# script này sinh ra để tránh. Ngày 02/09/2026 Nous thêm một khoá dịch mới
# (`sessionExpiredNoError`) vào `types.ts`; bản chép đè của gói kéo file đó về
# bản cũ, thế là **cả 16 ngôn ngữ khác** không biên dịch được — chỉ vì gói
# muốn thêm đúng một dòng `| "vi"`.
#
# Giờ sửa tại chỗ. Nous thêm khoá gì thì `types.ts` giữ nguyên khoá đó; phần
# tiếng Việt còn thiếu tự rơi về tiếng Anh, vì `vi.ts` dựng trên
# `defineLocale()` của chính Nous.

# VÌ SAO "mặc định tiếng Việt" nằm ở main.tsx chứ không ở context.tsx.
# Bản trước sửa thẳng `getInitialLocale()` để trả về "vi". Hệ quả: chạy
# `npm test` là hỏng bài kiểm thử của chính Nous (OAuthLoginModal tìm nút
# "Retry", nhận được "Thử lại"). Chọn ngôn ngữ cho lần mở đầu tiên là quyết
# định của ỨNG DỤNG, không phải của thư viện dịch — nên nó nằm ở main.tsx,
# nơi ứng dụng khởi động và không bài kiểm thử đơn vị nào nạp tới. Nhờ vậy
# `getInitialLocale()` giữ nguyên bản gốc, mã chạy thật và mã chạy test là
# một, và bài kiểm thử của Nous vẫn xanh.

VI_LOCALE_KEY = "hermes-max-vietnamese-default-v1"

VI_LOCALE_BOOTSTRAP = """
// Vá bởi Hermes Max: gói này lấy tiếng Việt làm mặc định cho lần mở đầu
// tiên. Chạy đúng một lần, và KHÔNG đè lên ngôn ngữ người dùng đã tự chọn —
// sau lần đó thanh chuyển ngôn ngữ toàn quyền quyết định.
try {
  if (localStorage.getItem("hermes-max-vietnamese-default-v1") !== "1") {
    localStorage.setItem("hermes-max-vietnamese-default-v1", "1");
    if (!localStorage.getItem("hermes-locale")) {
      localStorage.setItem("hermes-locale", "vi");
    }
  }
} catch {
  // Trình duyệt chặn localStorage — cứ để Hermes dùng mặc định của nó.
}
"""


def _insert_after(source: str, anchor: str, addition: str, what: str) -> str:
    """Chèn sau đúng một chỗ neo, hoặc bỏ qua chứ không đoán."""
    if source.count(anchor) != 1:
        raise Skip(f"không nhận ra {what}")
    return source.replace(anchor, anchor + addition, 1)


def register_vietnamese_web(repo: Path, check: bool) -> str:
    web = repo / "web" / "src"
    types_path = web / "i18n" / "types.ts"
    context_path = web / "i18n" / "context.tsx"
    main_path = web / "main.tsx"
    for path, label in (
        (types_path, "web/src/i18n/types.ts"),
        (context_path, "web/src/i18n/context.tsx"),
        (main_path, "web/src/main.tsx"),
    ):
        if not path.is_file():
            raise Skip(f"không thấy {label}")

    types_source = read(types_path)
    context_source = read(context_path)
    main_source = read(main_path)

    types_done = '| "vi"' in types_source
    context_done = 'import { vi } from "./vi";' in context_source
    main_done = VI_LOCALE_KEY in main_source
    if types_done and context_done and main_done:
        return ALREADY
    if check:
        return "CHƯA vá"

    if not types_done:
        types_source = _insert_after(
            types_source,
            'export type Locale =\n  | "en"\n',
            '  | "vi"\n',
            "union Locale trong types.ts",
        )

    # Chỉ đăng ký ngôn ngữ. Không đổi một dòng hành vi nào trong file này.
    if not context_done:
        context_source = _insert_after(
            context_source,
            'import { en } from "./en";\n',
            'import { vi } from "./vi";\n',
            "khối import locale",
        )
        context_source = _insert_after(
            context_source,
            "const TRANSLATIONS: Record<Locale, Translations> = {\n  en,\n",
            "  vi,\n",
            "bảng TRANSLATIONS",
        )
        context_source = _insert_after(
            context_source,
            '  en: { name: "English" },\n',
            '  vi: { name: "Tiếng Việt" },\n',
            "bảng LOCALE_META",
        )

    if not main_done:
        main_source = _insert_after(
            main_source,
            "exposePluginSDK();\n",
            VI_LOCALE_BOOTSTRAP,
            "điểm khởi động trong main.tsx",
        )

    if not types_done:
        write(types_path, types_source)
    if not context_done:
        write(context_path, context_source)
    if not main_done:
        write(main_path, main_source)
    return APPLIED


STEPS = (
    ("Đăng ký tiếng Việt", register_vietnamese),
    ("Sửa lỗi thu hồi quyền", fix_permission_reload),
    ("Đồng bộ khoá dịch", fill_locale_gaps),
    ("Chặn nhảy vào phiên agent phụ", fix_descendant_walk),
    ("Đăng ký tiếng Việt cho Dashboard", register_vietnamese_web),
)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    repo = Path(args[0] if args else ".").resolve()

    if not (repo / "agent").is_dir():
        print(f"HERMES_PATCH_FAIL: khong tim thay repo Hermes tai: {repo}")
        raise SystemExit(1)

    skipped = 0
    for label, step in STEPS:
        try:
            status = step(repo, check)
        except Skip as reason:
            status = f"BỎ QUA ({reason})"
            skipped += 1
        except Exception as exc:  # noqa: BLE001
            print(f"HERMES_PATCH_FAIL: {label}: {exc}")
            raise SystemExit(1)
        print(f"  {label}: {status}")

    suffix = f" ({skipped} bước bị bỏ qua)" if skipped else ""
    print(f"HERMES_PATCH_PASS{suffix}")


if __name__ == "__main__":
    main()
