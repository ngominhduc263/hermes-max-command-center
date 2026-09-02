/**
 * "Quyền & phê duyệt" — the Dashboard's view of Hermes's approval config.
 *
 * When a dangerous command comes up, Hermes asks. Pressing "always" writes the
 * matched pattern's key into `command_allowlist` in config.yaml, permanently.
 * Until now the only way to see or undo that was `hermes config edit`, which
 * is a lot to ask of someone who just wants to take a permission back.
 *
 * Three lists live behind this screen, all in config.yaml:
 *
 *   command_allowlist  — what the user has permanently allowed
 *   approvals.deny     — what the user has permanently forbidden; checked
 *                        BEFORE the yolo / mode=off bypass, so it outranks
 *                        everything else the agent can do
 *   approvals.mode     — manual (ask every time) / smart / off (never ask)
 *
 * Entries in `command_allowlist` are not commands — they are the *keys* of the
 * patterns that matched, in English, straight out of tools/approval.py. So the
 * job here is mostly translation: turn "delete in root path" into a sentence
 * that says what was actually handed over.
 *
 * Everything in this file is pure. The panel does the I/O.
 */

export type PermissionRisk = "critical" | "high" | "medium";

export type PermissionKind =
  | "pattern" /* a known key from DANGEROUS_PATTERNS */
  | "security" /* tirith:<rule> — the pre-exec security scanner */
  | "plugin" /* plugin_rule:<tool>:<hash> */
  | "code" /* execute_code */
  | "glob" /* a hand-written command glob, e.g. `cargo *` */
  | "unknown";

export interface PermissionEntry {
  /** The raw string as stored in config.yaml — what revoking removes. */
  key: string;
  /** What this permission actually lets Hermes do, in Vietnamese. */
  vi: string;
  risk: PermissionRisk;
  kind: PermissionKind;
}

interface PatternNote {
  vi: string;
  risk: PermissionRisk;
}

/**
 * The keys `tools/approval.py` writes, translated. Generated against Hermes
 * v0.20.6's DANGEROUS_PATTERNS (98 distinct keys) — an install with a newer
 * pattern list still shows the key verbatim, it just does not get a sentence.
 */
export const PATTERN_VI: Record<string, PatternNote> = {
  // ── Xoá dữ liệu ────────────────────────────────────────────────────
  "delete in root path": {
    risk: "critical",
    vi: "Xoá thẳng trong thư mục gốc của ổ đĩa — mất cả cây thư mục, không có thùng rác.",
  },
  "recursive delete": {
    risk: "critical",
    vi: "Xoá đệ quy cả thư mục con (rm -rf) — không khôi phục lại được.",
  },
  "recursive delete (long flag)": {
    risk: "critical",
    vi: "Xoá đệ quy cả thư mục con, viết bằng cờ dài (--recursive --force).",
  },
  "recursive delete (flags after operands)": {
    risk: "critical",
    vi: "Xoá đệ quy với cờ đặt sau tên thư mục — vẫn là rm -rf, chỉ khác thứ tự.",
  },
  "Windows cmd destructive delete": {
    risk: "critical",
    vi: "Xoá hàng loạt bằng cmd của Windows (del /q, rd /s) — không qua thùng rác.",
  },
  "Windows PowerShell destructive delete": {
    risk: "critical",
    vi: "Xoá hàng loạt bằng PowerShell — không qua thùng rác.",
  },
  "PowerShell destructive delete (Remove-Item)": {
    risk: "critical",
    vi: "Xoá bằng Remove-Item của PowerShell, thường kèm -Recurse -Force.",
  },
  "Windows destructive delete (recursive/quiet switch)": {
    risk: "critical",
    vi: "Xoá trên Windows với cờ đệ quy/im lặng — xoá sạch mà không hỏi lại câu nào.",
  },
  "xargs with rm": {
    risk: "high",
    vi: "Đưa cả danh sách file vào lệnh xoá qua xargs — một dòng xoá rất nhiều file.",
  },
  "find -exec/-execdir rm": {
    risk: "high",
    vi: "Tìm file rồi xoá luôn từng cái tìm được.",
  },
  "find -delete": {
    risk: "high",
    vi: "Tìm file rồi xoá thẳng bằng chính lệnh find.",
  },

  // ── Ổ đĩa và hệ thống tập tin ──────────────────────────────────────
  "format filesystem": {
    risk: "critical",
    vi: "Định dạng lại hệ thống tập tin — xoá trắng toàn bộ dữ liệu trên phân vùng.",
  },
  "format filesystem (Format-Volume)": {
    risk: "critical",
    vi: "Định dạng lại một phân vùng bằng PowerShell — xoá trắng phân vùng đó.",
  },
  "format drive (format.com)": {
    risk: "critical",
    vi: "Định dạng ổ đĩa bằng format.com — xoá trắng cả ổ.",
  },
  "wipe disk (Clear-Disk)": {
    risk: "critical",
    vi: "Xoá sạch cả ổ đĩa kể cả bảng phân vùng.",
  },
  "disk partitioning (diskpart)": {
    risk: "critical",
    vi: "Chia lại phân vùng ổ đĩa — có thể xoá phân vùng đang chứa dữ liệu.",
  },
  "wipe free space (cipher /w)": {
    risk: "high",
    vi: "Ghi đè vùng trống trên ổ để dữ liệu đã xoá không cứu lại được nữa.",
  },
  "disk copy": {
    risk: "critical",
    vi: "Sao chép ở mức ổ đĩa (dd) — ghi đè thẳng lên ổ đích.",
  },
  "write to block device": {
    risk: "critical",
    vi: "Ghi thẳng vào thiết bị ổ đĩa, bỏ qua hệ thống tập tin — hỏng ổ như chơi.",
  },
  "delete volume shadow copies (vssadmin)": {
    risk: "critical",
    vi: "Xoá các bản chụp khôi phục của Windows — mất luôn đường lùi khi có sự cố.",
  },
  "delete backups (wbadmin)": {
    risk: "critical",
    vi: "Xoá các bản sao lưu của Windows Backup.",
  },
  "modify boot configuration (bcdedit /set)": {
    risk: "critical",
    vi: "Sửa cấu hình khởi động của Windows — sai một chút là máy không lên được.",
  },

  // ── Quyền hạn và thông tin nhạy cảm ────────────────────────────────
  "grant Everyone access (icacls)": {
    risk: "critical",
    vi: "Mở quyền truy cập cho mọi tài khoản trên máy vào file/thư mục đó.",
  },
  "reset ACLs recursively (icacls /reset)": {
    risk: "high",
    vi: "Đặt lại toàn bộ phân quyền của cả cây thư mục về mặc định.",
  },
  "world/other-writable permissions": {
    risk: "high",
    vi: "Cho phép mọi người ghi vào file (chmod 777) — ai cũng sửa được.",
  },
  "recursive world/other-writable (long flag)": {
    risk: "high",
    vi: "Cho phép mọi người ghi vào cả cây thư mục.",
  },
  "recursive chown to root": {
    risk: "high",
    vi: "Đổi chủ sở hữu cả cây thư mục sang root.",
  },
  "recursive chown to root (long flag)": {
    risk: "high",
    vi: "Đổi chủ sở hữu cả cây thư mục sang root, viết bằng cờ dài.",
  },
  "access to SSH keys (Windows path)": {
    risk: "critical",
    vi: "Đọc thư mục khoá SSH — khoá riêng lộ là đăng nhập được vào máy chủ của anh.",
  },
  "access to Hermes secrets (Windows path)": {
    risk: "critical",
    vi: "Đọc file bí mật của Hermes — chứa API key và token.",
  },
  "copy/move file into sensitive credential/SSH/shell-rc path": {
    risk: "critical",
    vi: "Ghi file vào thư mục khoá SSH hoặc file khởi động shell — cấy được cửa hậu.",
  },
  "in-place edit of sensitive credential/SSH/shell-rc path": {
    risk: "critical",
    vi: "Sửa trực tiếp file khoá SSH hoặc file khởi động shell.",
  },
  "in-place edit of sensitive credential/SSH/shell-rc path (long flag)": {
    risk: "critical",
    vi: "Sửa trực tiếp file khoá SSH hoặc file khởi động shell, viết bằng cờ dài.",
  },
  "in-place edit of sensitive credential/SSH/shell-rc path (perl/ruby)": {
    risk: "critical",
    vi: "Sửa trực tiếp file khoá SSH hoặc file khởi động shell bằng perl/ruby.",
  },
  "sudo with privilege flag (stdin/askpass/shell/list)": {
    risk: "critical",
    vi: "Chạy sudo theo kiểu tự đưa mật khẩu vào — leo quyền quản trị không cần hỏi anh.",
  },
  "sudo with combined-flag privilege escalation": {
    risk: "critical",
    vi: "Leo quyền quản trị bằng sudo với nhiều cờ gộp lại.",
  },

  // ── Chạy mã tải từ mạng ────────────────────────────────────────────
  "pipe remote content to shell": {
    risk: "critical",
    vi: "Tải nội dung từ mạng rồi chạy thẳng (curl | sh) — chạy mã chưa ai đọc qua.",
  },
  "pipe remote content to PowerShell (iwr | iex)": {
    risk: "critical",
    vi: "Tải nội dung từ mạng rồi chạy thẳng bằng PowerShell.",
  },
  "execute remote content via Invoke-Expression": {
    risk: "critical",
    vi: "Chạy nội dung tải từ mạng bằng Invoke-Expression.",
  },
  "execute remote script via process substitution": {
    risk: "critical",
    vi: "Chạy script tải từ mạng qua cơ chế process substitution của shell.",
  },
  "execute remote content via command substitution": {
    risk: "critical",
    vi: "Chạy nội dung tải từ mạng qua command substitution.",
  },
  "PowerShell encoded command execution": {
    risk: "critical",
    vi: "Chạy lệnh PowerShell đã mã hoá — nhìn vào không đọc được nó làm gì.",
  },
  "pipe decoded content to shell (possible command obfuscation)": {
    risk: "critical",
    vi: "Giải mã base64 rồi chạy — kiểu che giấu lệnh thật.",
  },
  "pipe xxd-decoded content to shell (possible command obfuscation)": {
    risk: "critical",
    vi: "Giải mã bằng xxd rồi chạy — kiểu che giấu lệnh thật.",
  },
  "pipe tr-transformed output to shell (possible command obfuscation)": {
    risk: "critical",
    vi: "Biến đổi chuỗi bằng tr rồi chạy — kiểu che giấu lệnh thật.",
  },
  "pipe openssl-decoded content to shell (possible command obfuscation)": {
    risk: "critical",
    vi: "Giải mã bằng openssl rồi chạy — kiểu che giấu lệnh thật.",
  },
  "shell execution via heredoc": {
    risk: "high",
    vi: "Đưa cả khối lệnh vào shell bằng heredoc.",
  },
  "chmod +x followed by immediate execution": {
    risk: "high",
    vi: "Cấp quyền chạy cho một file rồi chạy nó ngay lập tức.",
  },

  // ── Ghi đè cấu hình ────────────────────────────────────────────────
  "overwrite system config": {
    risk: "critical",
    vi: "Ghi đè file cấu hình hệ thống.",
  },
  "overwrite system file via tee": {
    risk: "critical",
    vi: "Ghi đè file hệ thống qua tee.",
  },
  "overwrite system file via redirection": {
    risk: "critical",
    vi: "Ghi đè file hệ thống bằng dấu chuyển hướng (>).",
  },
  "in-place edit of system config": {
    risk: "critical",
    vi: "Sửa trực tiếp file cấu hình hệ thống.",
  },
  "in-place edit of system config (long flag)": {
    risk: "critical",
    vi: "Sửa trực tiếp file cấu hình hệ thống, viết bằng cờ dài.",
  },
  "copy/move file into system config path": {
    risk: "critical",
    vi: "Chép hoặc chuyển file vào thư mục cấu hình hệ thống.",
  },
  "overwrite project env/config via tee": {
    risk: "high",
    vi: "Ghi đè file .env hoặc cấu hình của dự án qua tee — có thể mất API key.",
  },
  "overwrite project env/config via redirection": {
    risk: "high",
    vi: "Ghi đè file .env hoặc cấu hình của dự án bằng dấu chuyển hướng.",
  },
  "overwrite project env/config file": {
    risk: "high",
    vi: "Ghi đè file .env hoặc cấu hình của dự án.",
  },
  "in-place edit of Hermes config/env": {
    risk: "critical",
    vi: "Sửa trực tiếp cấu hình hoặc .env của chính Hermes — sửa được cả phần phân quyền này.",
  },
  "in-place edit of Hermes config/env (long flag)": {
    risk: "critical",
    vi: "Sửa trực tiếp cấu hình/.env của Hermes, viết bằng cờ dài.",
  },
  "in-place edit of Hermes config/env (perl/ruby)": {
    risk: "critical",
    vi: "Sửa trực tiếp cấu hình/.env của Hermes bằng perl/ruby.",
  },
  "registry delete (reg delete)": {
    risk: "critical",
    vi: "Xoá khoá registry của Windows.",
  },
  "registry value delete (Remove-ItemProperty -Force)": {
    risk: "high",
    vi: "Xoá giá trị trong registry của Windows.",
  },

  // ── Tiến trình và dịch vụ ──────────────────────────────────────────
  "kill all processes": {
    risk: "critical",
    vi: "Tắt toàn bộ tiến trình đang chạy — coi như treo máy.",
  },
  "force kill processes": {
    risk: "high",
    vi: "Buộc tắt tiến trình — chương trình bị tắt ngang, chưa kịp lưu.",
  },
  "force kill processes (taskkill /F)": {
    risk: "high",
    vi: "Buộc tắt tiến trình trên Windows bằng taskkill /F.",
  },
  "force kill processes (Stop-Process -Force)": {
    risk: "high",
    vi: "Buộc tắt tiến trình bằng PowerShell.",
  },
  "force kill processes (killall -KILL)": {
    risk: "high",
    vi: "Buộc tắt mọi tiến trình cùng tên bằng killall -KILL.",
  },
  "force kill processes (killall -s KILL)": {
    risk: "high",
    vi: "Buộc tắt mọi tiến trình cùng tên bằng killall -s KILL.",
  },
  "kill processes by regex (killall -r)": {
    risk: "high",
    vi: "Tắt mọi tiến trình có tên khớp một mẫu — dễ trúng nhầm cái đang cần.",
  },
  "fork bomb": {
    risk: "critical",
    vi: "Fork bomb — tự nhân bản tiến trình tới khi máy đứng hình.",
  },
  "stop/restart system service": {
    risk: "high",
    vi: "Dừng hoặc khởi động lại dịch vụ hệ thống.",
  },
  "force stop service (Stop-Service -Force)": {
    risk: "high",
    vi: "Buộc dừng một dịch vụ Windows.",
  },
  "stop/delete service (sc)": {
    risk: "high",
    vi: "Dừng hoặc xoá hẳn một dịch vụ Windows.",
  },

  // ── Chính Hermes ───────────────────────────────────────────────────
  "stop/restart hermes gateway (kills running agents)": {
    risk: "medium",
    vi: "Dừng hoặc khởi động lại gateway của Hermes — các agent đang chạy bị ngắt.",
  },
  "stop/restart hermes launchd service (kills running agents)": {
    risk: "medium",
    vi: "Dừng hoặc khởi động lại dịch vụ Hermes trên macOS.",
  },
  "hermes update (restarts gateway, kills running agents)": {
    risk: "medium",
    vi: "Chạy hermes update — khởi động lại gateway và ngắt việc đang chạy.",
  },
  "start gateway outside systemd (use 'systemctl --user restart hermes-gateway')": {
    risk: "medium",
    vi: "Khởi động gateway ngoài systemd — dễ thành hai bản chạy song song.",
  },
  "kill hermes/gateway process (self-termination)": {
    risk: "medium",
    vi: "Tắt tiến trình Hermes — chính nó tự tắt mình giữa chừng.",
  },
  "kill process via pgrep/pidof expansion (self-termination)": {
    risk: "medium",
    vi: "Tìm số hiệu tiến trình rồi tắt — có thể tắt trúng chính Hermes.",
  },
  "kill process via backtick pgrep/pidof expansion (self-termination)": {
    risk: "medium",
    vi: "Tìm số hiệu tiến trình bằng dấu backtick rồi tắt — có thể trúng chính Hermes.",
  },

  // ── Cơ sở dữ liệu ──────────────────────────────────────────────────
  "SQL DROP": {
    risk: "critical",
    vi: "Xoá hẳn bảng hoặc cả cơ sở dữ liệu.",
  },
  "SQL DELETE without WHERE": {
    risk: "critical",
    vi: "Xoá mọi dòng trong bảng vì thiếu điều kiện WHERE.",
  },
  "SQL TRUNCATE": {
    risk: "critical",
    vi: "Xoá sạch nội dung bảng.",
  },

  // ── Git ────────────────────────────────────────────────────────────
  "git reset --hard (destroys uncommitted changes)": {
    risk: "high",
    vi: "git reset --hard — mất hết thay đổi chưa commit.",
  },
  "git force push (rewrites remote history)": {
    risk: "high",
    vi: "Đẩy đè lên nhánh từ xa — ghi lại lịch sử, người khác có thể mất commit.",
  },
  "git force push short flag (rewrites remote history)": {
    risk: "high",
    vi: "Đẩy đè lên nhánh từ xa (dạng cờ ngắn -f).",
  },
  "git clean with force (deletes untracked files)": {
    risk: "high",
    vi: "git clean -f — xoá các file chưa được git theo dõi.",
  },
  "git branch force delete": {
    risk: "medium",
    vi: "Xoá nhánh git kể cả khi chưa merge.",
  },
  "git branch force delete (long flags)": {
    risk: "medium",
    vi: "Xoá nhánh git kể cả khi chưa merge, viết bằng cờ dài.",
  },
  "git branch force delete (long flags, force-first)": {
    risk: "medium",
    vi: "Xoá nhánh git kể cả khi chưa merge, cờ --force đặt trước.",
  },

  // ── Docker / Podman ────────────────────────────────────────────────
  "docker with remote daemon redirect (-H/--host)": {
    risk: "high",
    vi: "Trỏ docker sang máy chủ khác — lệnh chạy trên máy đó, không phải máy anh.",
  },
  "docker with daemon redirect (--context: alternate daemon)": {
    risk: "high",
    vi: "Đổi docker sang một context khác — lệnh chạy ở nơi khác.",
  },
  "docker context use (switches default daemon for future commands)": {
    risk: "high",
    vi: "Đổi context mặc định của docker — mọi lệnh sau đó chạy ở nơi khác.",
  },
  "podman with remote daemon redirect (--url/--connection/--identity)": {
    risk: "high",
    vi: "Trỏ podman sang máy chủ khác.",
  },
  "podman remote mode (-r/--remote: remote daemon)": {
    risk: "high",
    vi: "Chạy podman ở chế độ từ xa.",
  },
  "docker/podman daemon redirect via environment (DOCKER_HOST/CONTAINER_HOST)": {
    risk: "high",
    vi: "Đổi máy chủ docker/podman bằng biến môi trường — kín đáo hơn nên dễ bỏ sót.",
  },
  "docker compose restart/stop/kill/down (container lifecycle)": {
    risk: "medium",
    vi: "Dừng hoặc gỡ các container của docker compose.",
  },
  "docker restart/stop/kill (container lifecycle)": {
    risk: "medium",
    vi: "Dừng, tắt hoặc khởi động lại container.",
  },

  // ── Chạy chương trình qua cờ của lệnh khác ─────────────────────────
  // Không nằm trong DANGEROUS_PATTERNS mà do bộ dò `_execution_flag_findings`
  // sinh ra — cùng đường đi, cùng chỗ lưu, nên vẫn hiện ở bảng này.
  "script execution via -e/-c flag": {
    risk: "high",
    vi: "Chạy mã đưa thẳng trên dòng lệnh (python -c, perl -e, node -e…) — cấp quyền này là cho chạy bất cứ đoạn mã nào theo kiểu đó.",
  },
  "script execution via heredoc": {
    risk: "high",
    vi: "Đưa nguyên khối mã vào trình thông dịch bằng heredoc (python << …).",
  },
  "shell command via -c/-lc flag": {
    risk: "high",
    vi: "Chạy lệnh qua shell con (bash -c, sh -c…) — lệnh thật nằm trong chuỗi nên khó soi.",
  },
  "arbitrary program execution via sort --compress-program": {
    risk: "high",
    vi: "Lệnh sort chạy một chương trình khác qua --compress-program — nhìn như sắp xếp, thật ra là chạy chương trình.",
  },
  "arbitrary program execution via rg --pre": {
    risk: "high",
    vi: "Lệnh tìm kiếm rg chạy một chương trình khác qua --pre.",
  },
  "arbitrary program execution via rg --hostname-bin": {
    risk: "high",
    vi: "Lệnh tìm kiếm rg chạy một chương trình khác qua --hostname-bin.",
  },
  "arbitrary program execution via ag --pager": {
    risk: "high",
    vi: "Lệnh tìm kiếm ag chạy một chương trình khác qua --pager.",
  },
  "arbitrary program execution via man --pager": {
    risk: "high",
    vi: "Lệnh man chạy một chương trình khác qua --pager.",
  },
  "arbitrary program execution via man --html": {
    risk: "high",
    vi: "Lệnh man chạy một chương trình khác qua --html.",
  },
  "arbitrary program execution via man -P": {
    risk: "high",
    vi: "Lệnh man chạy một chương trình khác qua -P.",
  },
  "arbitrary program execution via man -H": {
    risk: "high",
    vi: "Lệnh man chạy một chương trình khác qua -H.",
  },
  "command parser limit or malformed executable payload": {
    risk: "critical",
    vi: "Lệnh dài hoặc méo tới mức Hermes không phân tích nổi. Cấp quyền này là bỏ luôn lớp bảo vệ cho những lệnh nó không đọc được.",
  },
  "stop/restart hermes gateway via shell-spliced verb (kills running agents)": {
    risk: "medium",
    vi: "Dừng/khởi động lại gateway Hermes bằng lệnh ghép qua shell — các agent đang chạy bị ngắt.",
  },
  ssh_config_write: {
    risk: "critical",
    vi: "Ghi vào file cấu hình SSH — sửa được máy chủ và khoá mà máy anh kết nối tới.",
  },
};

/**
 * Approvals written by an older Hermes, before the keys became readable
 * sentences: `command_allowlist` may still hold the raw regex fragment, and
 * `_approval_key_aliases` in tools/approval.py still honours it. Same grant,
 * older spelling.
 */
export const LEGACY_KEY_ALIASES: Record<string, string> = {
  "(python[23]?|perl|ruby|node)\\s+-[ec]\\s+": "script execution via -e/-c flag",
  "(python[23]?|perl|ruby|node)\\s+<<": "script execution via heredoc",
};

/** Nhãn ngắn cho mỗi mức rủi ro. */
export const RISK_VI: Record<PermissionRisk, string> = {
  critical: "Rất nguy hiểm",
  high: "Nguy hiểm",
  medium: "Cần cân nhắc",
};

/** Sort order: the scariest thing the user granted goes to the top. */
const RISK_ORDER: Record<PermissionRisk, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/**
 * Explain one `command_allowlist` entry. Falls back to a shape-based
 * description so an entry from a newer Hermes still reads as *something*
 * rather than a bare English fragment.
 */
export function describePermission(key: string): PermissionEntry {
  const trimmed = key.trim();

  const known = PATTERN_VI[trimmed];
  if (known) {
    return { key: trimmed, kind: "pattern", risk: known.risk, vi: known.vi };
  }

  if (trimmed.startsWith("tirith:")) {
    return {
      key: trimmed,
      kind: "security",
      risk: "critical",
      vi: `Bỏ qua cảnh báo bảo mật "${trimmed.slice("tirith:".length)}" của bộ quét tirith.`,
    };
  }

  if (trimmed.startsWith("plugin_rule:")) {
    const tool = trimmed.slice("plugin_rule:".length).split(":")[0];
    return {
      key: trimmed,
      kind: "plugin",
      risk: "high",
      vi: `Luật phê duyệt do tiện ích đặt ra cho công cụ "${tool}".`,
    };
  }

  if (trimmed === "execute_code") {
    return {
      key: trimmed,
      kind: "code",
      risk: "critical",
      vi: "Chạy mã tuỳ ý bằng execute_code — không đi qua cổng duyệt lệnh terminal.",
    };
  }

  // An entry written by an older Hermes: same permission, older spelling.
  const canonical = LEGACY_KEY_ALIASES[trimmed];
  if (canonical && PATTERN_VI[canonical]) {
    const note = PATTERN_VI[canonical];
    return {
      key: trimmed,
      kind: "pattern",
      risk: note.risk,
      vi: `${note.vi} (mục cũ, bản Hermes trước ghi bằng ký hiệu này)`,
    };
  }

  // A hand-written glob (`cargo *`) or a Claude Code import (`Bash(npm run *)`)
  // is matched against the command itself, not against a pattern key. The
  // import form is unambiguous, so it is recognised before the regex guard
  // below — its own parentheses would otherwise trip it.
  const isImportRule = /^Bash\(.*\)$/.test(trimmed);
  // Regex leftovers from an older Hermes look glob-ish too — `\s`, `\b`,
  // groups and alternation give them away, and calling one a glob would
  // misdescribe what it actually matches.
  const looksLikeRegex = !isImportRule && /\\[sbdw]|\(|\||\+$/.test(trimmed);
  if (isImportRule || (!looksLikeRegex && /[*?[\]]/.test(trimmed))) {
    return {
      key: trimmed,
      kind: "glob",
      risk: "medium",
      vi: `Mọi lệnh khớp mẫu "${trimmed}" đều chạy thẳng, không hỏi lại.`,
    };
  }

  return {
    key: trimmed,
    kind: "unknown",
    risk: "high",
    vi: "Một quyền do bản Hermes này đặt tên — Dashboard chưa có mô tả tiếng Việt.",
  };
}

/** Read `command_allowlist` out of a config document, most-dangerous first. */
export function grantedPermissions(config: unknown): PermissionEntry[] {
  const raw = (config as Record<string, unknown> | null)?.["command_allowlist"];
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const entries: PermissionEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    const described = describePermission(item);
    if (seen.has(described.key)) continue;
    seen.add(described.key);
    entries.push(described);
  }

  return entries.sort(
    (a, b) =>
      RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.key.localeCompare(b.key),
  );
}

export type ApprovalMode = "manual" | "smart" | "off";

const APPROVAL_MODES: ApprovalMode[] = ["manual", "smart", "off"];

export interface ApprovalModeNote {
  mode: ApprovalMode;
  label: string;
  vi: string;
}

export const APPROVAL_MODE_VI: ApprovalModeNote[] = [
  {
    label: "Hỏi mọi lúc",
    mode: "manual",
    vi: "Mọi lệnh nguy hiểm đều dừng lại chờ anh duyệt. An toàn nhất, cũng phiền nhất.",
  },
  {
    label: "Hỏi thông minh",
    mode: "smart",
    vi: "Hermes tự đánh giá rồi chỉ hỏi khi thật sự rủi ro. Đây là mặc định.",
  },
  {
    label: "Không hỏi",
    mode: "off",
    vi: "Không hỏi gì cả, lệnh nào cũng chạy. Chỉ nên dùng trong máy ảo hoặc container.",
  },
];

/**
 * Read `approvals.mode`. YAML 1.1 parses a bare `off` as the boolean false,
 * which is exactly what someone hand-editing the file would write — Hermes
 * itself treats that as the string, so this must too.
 */
export function approvalMode(config: unknown): ApprovalMode {
  const approvals = (config as Record<string, unknown> | null)?.["approvals"];
  const raw =
    approvals && typeof approvals === "object" && !Array.isArray(approvals)
      ? (approvals as Record<string, unknown>)["mode"]
      : undefined;

  if (raw === false) return "off";
  if (raw === true) return "manual";
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if ((APPROVAL_MODES as string[]).includes(value)) return value as ApprovalMode;
  }
  return "smart";
}

/** Read `approvals.deny` — the user's own hard-block globs. */
export function denyRules(config: unknown): string[] {
  const approvals = (config as Record<string, unknown> | null)?.["approvals"];
  const raw =
    approvals && typeof approvals === "object" && !Array.isArray(approvals)
      ? (approvals as Record<string, unknown>)["deny"]
      : undefined;
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const rule = item.trim();
    if (rule && !out.some((existing) => existing.toLowerCase() === rule.toLowerCase())) {
      out.push(rule);
    }
  }
  return out;
}

/** Clean up a typed block rule the way Hermes will read it back. */
export function normalizeDenyRule(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function addDenyRule(rules: string[], raw: string): string[] {
  const rule = normalizeDenyRule(raw);
  if (!rule) return rules;
  if (rules.some((existing) => existing.toLowerCase() === rule.toLowerCase())) {
    return rules;
  }
  return [...rules, rule];
}

export function removeDenyRule(rules: string[], raw: string): string[] {
  const rule = normalizeDenyRule(raw).toLowerCase();
  return rules.filter((existing) => existing.toLowerCase() !== rule);
}

/**
 * A rule with no wildcard only ever matches that exact command line, which is
 * almost never what someone means by "block deleting things".
 */
export function denyRuleWarning(raw: string): string | null {
  const rule = normalizeDenyRule(raw);
  if (!rule) return null;
  if (!/[*?]/.test(rule)) {
    return `Mẫu này chỉ chặn đúng chuỗi "${rule}". Thêm dấu * để chặn cả các lệnh có thêm tham số, ví dụ "${rule} *".`;
  }
  return null;
}

/**
 * The body for `PUT /api/config`. The endpoint deep-merges over what is on
 * disk and replaces lists wholesale, so sending only the keys being changed
 * both revokes correctly and cannot clobber the rest of the config.
 */
export function buildConfigPatch(options: {
  allowlist?: string[];
  deny?: string[];
  mode?: ApprovalMode;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (options.allowlist) patch.command_allowlist = [...options.allowlist];

  const approvals: Record<string, unknown> = {};
  if (options.deny) approvals.deny = [...options.deny];
  if (options.mode) approvals.mode = options.mode;
  if (Object.keys(approvals).length) patch.approvals = approvals;

  return patch;
}

/** Revoke one granted permission, leaving everything else in place. */
export function revokePermission(allowlist: string[], key: string): string[] {
  const wanted = key.trim();
  return allowlist.filter((entry) => entry.trim() !== wanted);
}

/** The raw `command_allowlist` strings, unsorted — what a patch must preserve. */
export function rawAllowlist(config: unknown): string[] {
  const raw = (config as Record<string, unknown> | null)?.["command_allowlist"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is string => typeof item === "string" && !!item.trim(),
  );
}
