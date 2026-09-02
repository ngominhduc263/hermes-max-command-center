#!/usr/bin/env python3
"""Kiểm tra bộ dịch tiếng Việt của Hermes sau khi cài.

Chạy lại đúng ba bất biến mà tests/agent/test_i18n.py của Hermes bảo vệ, nhưng
không cần pytest — installer gọi thẳng file này bằng python trong venv của
Hermes:

    python Test-HermesVietnamese.py "D:\\HERMES AGENT\\hermes-agent"

1. locales/vi.yaml có đúng tập khoá của locales/en.yaml (thiếu khoá nào là
   người dùng rơi ngược về tiếng Anh ở đúng chỗ đó).
2. Mỗi câu dịch giữ nguyên các {placeholder} như bản tiếng Anh — sai một cái
   là str.format ném lỗi hoặc nuốt mất giá trị lúc chạy thật.
3. agent.i18n thật sự trả về tiếng Việt khi chọn ngôn ngữ "vi" — tức là "vi"
   đã được đăng ký trong SUPPORTED_LANGUAGES chứ không âm thầm rơi về "en".

In HERMES_VI_PASS và thoát 0 nếu đạt; in lý do và thoát 1 nếu hỏng.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

PLACEHOLDER = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def flatten(node, prefix: str = "") -> dict[str, str]:
    """Catalogs nest for readability only; the keys are the dotted paths."""
    out: dict[str, str] = {}
    for key, value in (node or {}).items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def fail(message: str) -> None:
    """Báo hỏng — nhưng đây KHÔNG phải lý do để huỷ cả bản cài.

    Thiếu một câu dịch thì `t()` tự rơi về tiếng Anh đúng câu đó; không
    có gì sập. Installer đọc mã thoát này để BÁO CÁO, không để chặn.
    Patch-HermesCore.py chạy trước đó cũng đã bù các khoá còn thiếu theo
    en.yaml của chính bản Hermes đang cài, nên bình thường sẽ không tới
    lượt hàm này.
    """
    print(f"HERMES_VI_FAIL: {message}")
    print("  (chi la phan dich — Hermes van chay, cac cau thieu hien tieng Anh)")
    raise SystemExit(1)


def main() -> None:
    repo = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not (repo / "agent" / "i18n.py").is_file():
        fail(f"khong tim thay repo Hermes tai: {repo}")

    try:
        import yaml
    except ImportError:
        fail("python nay khong co pyyaml — hay dung python trong venv cua Hermes")

    locales = repo / "locales"
    for name in ("en", "vi"):
        if not (locales / f"{name}.yaml").is_file():
            fail(f"thieu locales/{name}.yaml")

    def load(name: str) -> dict[str, str]:
        with (locales / f"{name}.yaml").open(encoding="utf-8") as handle:
            return flatten(yaml.safe_load(handle))

    en, vi = load("en"), load("vi")

    missing = sorted(set(en) - set(vi))
    extra = sorted(set(vi) - set(en))
    if missing:
        fail(f"vi.yaml thieu {len(missing)} khoa, vi du: {missing[:5]}")
    if extra:
        fail(f"vi.yaml co {len(extra)} khoa la, vi du: {extra[:5]}")

    for key, english in en.items():
        want = set(PLACEHOLDER.findall(english))
        got = set(PLACEHOLDER.findall(vi[key]))
        if want != got:
            fail(f"khoa {key!r}: placeholder {sorted(got)} khac ban goc {sorted(want)}")

    # A value with a stray brace only explodes at format() time, in front of
    # the user, so exercise every one of them here instead.
    for key, text in vi.items():
        try:
            text.format(**{name: "X" for name in PLACEHOLDER.findall(text)})
        except Exception as exc:  # noqa: BLE001 — any failure is a failure
            fail(f"khoa {key!r} khong format duoc: {exc}")

    # And the part a catalog file alone cannot prove: that Hermes actually
    # routes to it. If "vi" is missing from SUPPORTED_LANGUAGES this silently
    # returns the English string.
    sys.path.insert(0, str(repo))
    os.environ["HERMES_LANGUAGE"] = "vi"
    try:
        from agent import i18n
    except Exception as exc:  # noqa: BLE001
        fail(f"khong import duoc agent.i18n: {exc}")

    if "vi" not in i18n.SUPPORTED_LANGUAGES:
        fail("agent/i18n.py chua dang ky 'vi' trong SUPPORTED_LANGUAGES")

    i18n.reset_language_cache()
    probe = "approval.dangerous_header"
    rendered = i18n.t(probe, lang="vi", description="X")
    if rendered == en[probe].format(description="X"):
        fail(f"khoa {probe!r} van tra ve tieng Anh")
    if not rendered.startswith("⚠️  LỆNH NGUY HIỂM"):
        fail(f"khoa {probe!r} tra ve chuoi la: {rendered!r}")

    coverage = permission_coverage(repo)

    print(f"HERMES_VI_PASS: {len(vi)} cau tieng Viet, khop 100% voi en.yaml{coverage}")


def approvable_keys() -> set[str]:
    """Every pattern key THIS install can persist into command_allowlist.

    Asked of the module rather than hardcoded, because the answer moves with
    the user's Hermes version. `DANGEROUS_PATTERNS` is only the biggest
    source: `_execution_flag_findings` yields several more (that is how
    "script execution via -e/-c flag" reached a real allowlist while the first
    release of the panel had no Vietnamese for it), the read-tool exec flags
    expand into one key per tool+flag, and two capability gates use fixed
    keys of their own.

    Deliberately excluded: hardline-blocklist descriptions and `tirith:` rules
    can never be permanently allowed — the first never prompts, the second is
    forced to session scope.
    """
    import inspect

    from tools import approval

    keys = {description for _pattern, description in approval.DANGEROUS_PATTERNS}

    for name in ("_MALFORMED_EXEC_DESCRIPTION", "_GATEWAY_LIFECYCLE_SPLICE_DESCRIPTION"):
        value = getattr(approval, name, None)
        if isinstance(value, str):
            keys.add(value)

    finder = getattr(approval, "_execution_flag_findings", None)
    if finder is not None:
        keys |= set(re.findall(r'yield \("([^"]+)"', inspect.getsource(finder)))

    for tool, options in (getattr(approval, "_READ_TOOL_EXEC_FLAGS", None) or {}).items():
        for option in options:
            keys.add(f"arbitrary program execution via {tool} {option}")

    keys |= {"execute_code", "ssh_config_write"}
    return keys


def permission_coverage(repo: Path) -> str:
    """Report how much of THIS install's danger list the panel can explain.

    The "Quyền & phê duyệt" panel translates the pattern keys Hermes writes
    into command_allowlist. A newer Hermes can ship patterns the dictionary
    has never seen — those still show, just in English, so this is a note and
    never a failure. Silent on a perfect match.
    """
    source = repo / "web" / "src" / "lib" / "hermes-permissions.ts"
    if not source.is_file():
        return ""

    try:
        text = source.read_text(encoding="utf-8")
        block = text.split("export const PATTERN_VI", 1)[1].split("\n};", 1)[0]
        translated = set(re.findall(r'^  "((?:[^"\\]|\\.)*)": \{', block, re.M))
        # Keys that need no quoting in TS object literal syntax.
        translated |= set(re.findall(r"^  ([A-Za-z_][A-Za-z0-9_]*): \{", block, re.M))
        # Described in describePermission rather than the table.
        translated.add("execute_code")

        actual = approvable_keys()
    except Exception:
        # Never let a cosmetic count break an install.
        return ""

    if not translated:
        return ""

    missing = actual - translated
    if not missing:
        return f"; {len(actual)}/{len(actual)} loai quyen co mo ta tieng Viet"
    return (
        f"; {len(actual) - len(missing)}/{len(actual)} loai quyen co mo ta "
        f"tieng Viet ({len(missing)} loai moi se hien tieng Anh)"
    )


if __name__ == "__main__":
    main()
