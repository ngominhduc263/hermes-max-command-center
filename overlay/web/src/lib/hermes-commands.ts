/**
 * Hermes slash commands, for the Dashboard's own `/` palette.
 *
 * The terminal gets this list from the gateway (`commands.catalog`), but the
 * dashboard has no RPC channel to it — the PTY is the only link — so the
 * catalog is baked in here. Generated from `hermes_cli/commands.py`'s
 * COMMAND_REGISTRY for Hermes Agent v0.20.6, applying the same filter the TUI
 * uses (`_TUI_HIDDEN` and gateway-only commands dropped, `_TUI_EXTRA` added).
 *
 * The palette only ever SUGGESTS: whatever is typed still goes to the TUI
 * verbatim, so a command added by a later `hermes update` keeps working even
 * before it is listed here.
 */

export interface HermesCommand {
  name: string;
  aliases?: string[];
  /** Argument hint shown after the name, e.g. "<name>". */
  args?: string;
  category: string;
  /** The registry's own English one-liner, as `/help` prints it. */
  description: string;
  /** Vietnamese explanation shown in the palette and the reference sheet. */
  vi: string;
  /** Everyday commands: listed first and highlighted. */
  common?: boolean;
  /**
   * Opens a full-screen picker inside the TUI. The chat view cannot show it,
   * so the page switches to the Terminal tab when one of these is sent.
   */
  needsTerminal?: boolean;
  /**
   * Where the entry came from. `"gateway"` marks a command this install
   * advertised that the baked list never had — a newer Hermes, a plugin, a
   * quick command, a skill. See lib/chat-command-catalog.ts.
   */
  source?: "gateway";
}

/** Ordered: everyday commands first, then by category and name. */
export const HERMES_COMMANDS: HermesCommand[] = [
  {
    name: "new",
    aliases: ["reset"],
    args: "[name]",
    category: "Phiên",
    description: "Start a new session (fresh session ID + history) (usage: /new [name])",
    vi: "Mở phiên mới hoàn toàn — ID phiên và lịch sử đều làm lại từ đầu.",
    common: true,
  },
  {
    name: "sessions",
    category: "Phiên",
    description: "Browse and resume previous sessions",
    vi: "Duyệt và mở lại các phiên trước.",
    common: true,
    needsTerminal: true,
  },
  {
    name: "resume",
    args: "[name]",
    category: "Phiên",
    description: "Resume a previously-named session (usage: /resume [name])",
    vi: "Mở lại một phiên đã đặt tên trước đó.",
    common: true,
  },
  {
    name: "model",
    args: "[model] [--provider name] [--global|--session] [--refresh]",
    category: "Cấu hình",
    description: "Switch model (session-scoped; --global to persist) (usage: /model [model] [--provider name] [--global|--session] [--refresh])",
    vi: "Đổi mô hình cho phiên hiện tại; thêm --global để lưu vĩnh viễn, --refresh để tải lại danh sách.",
    common: true,
    needsTerminal: true,
  },
  {
    name: "status",
    category: "Phiên",
    description: "Show session, model, token, and context info",
    vi: "Xem thông tin phiên, mô hình, token và ngữ cảnh.",
    common: true,
  },
  {
    name: "context",
    aliases: ["ctx"],
    args: "[all]",
    category: "Phiên",
    description: "Show detailed context window view with usage gauge, category breakdown, compression stats, and throughput (usage: /context [all])",
    vi: "Xem chi tiết cửa sổ ngữ cảnh: mức dùng, phân bổ theo nhóm, thống kê nén và thông lượng.",
    common: true,
  },
  {
    name: "usage",
    args: "[reset [--force]]",
    category: "Thông tin",
    description: "Show token usage and rate limits; `reset` redeems a banked Codex limit reset (usage: /usage [reset [--force]])",
    vi: "Xem lượng token đã dùng và giới hạn tốc độ; 'reset' dùng để đổi một lần reset giới hạn Codex đang dành sẵn.",
    common: true,
  },
  {
    name: "stop",
    category: "Phiên",
    description: "Kill all running background processes",
    vi: "Dừng toàn bộ tiến trình nền đang chạy.",
    common: true,
  },
  {
    name: "undo",
    args: "[N]",
    category: "Phiên",
    description: "Back up N user turns and re-prompt (default 1) (usage: /undo [N])",
    vi: "Lùi lại N lượt của anh rồi hỏi lại từ đó (mặc định 1 lượt).",
    common: true,
  },
  {
    name: "retry",
    category: "Phiên",
    description: "Retry the last message (resend to agent)",
    vi: "Gửi lại tin nhắn gần nhất cho agent.",
    common: true,
  },
  {
    name: "queue",
    aliases: ["q"],
    args: "<prompt>",
    category: "Phiên",
    description: "Queue a prompt for the next turn (doesn't interrupt) (usage: /queue <prompt>)",
    vi: "Xếp một yêu cầu vào hàng chờ cho lượt kế tiếp, không cắt ngang lượt đang chạy.",
    common: true,
  },
  {
    name: "compress",
    aliases: ["compact"],
    args: "[here [N] | focus topic | --preview|--dry-run]",
    category: "Phiên",
    description: "Compress conversation context (add 'here [N]' to keep recent N turns; --preview shows what would happen) (usage: /compress [here [N] | focus topic | --preview|--dry-run])",
    vi: "Nén ngữ cảnh hội thoại cho gọn; thêm 'here N' để giữ lại N lượt gần nhất, '--preview' để xem trước.",
    common: true,
  },
  {
    name: "clear",
    category: "Phiên",
    description: "Clear screen and start a new session",
    vi: "Xoá màn hình và bắt đầu phiên mới.",
    common: true,
  },
  {
    name: "help",
    args: "[skills|<filter>]",
    category: "Thông tin",
    description: "Show available commands (/help skills lists skill commands, /help <text> filters) (usage: /help [skills|<filter>])",
    vi: "Xem danh sách lệnh; '/help skills' liệt kê lệnh kỹ năng, '/help <chữ>' để lọc.",
    common: true,
  },
  {
    name: "skills",
    category: "Công cụ & Kỹ năng",
    description: "Search, install, inspect, or manage skills",
    vi: "Tìm, cài, xem và quản lý kỹ năng.",
    common: true,
    needsTerminal: true,
  },
  {
    name: "image",
    args: "<path>",
    category: "Thông tin",
    description: "Attach a local image file for your next prompt (usage: /image <path>)",
    vi: "Đính kèm một ảnh trong máy cho câu hỏi kế tiếp.",
    common: true,
  },
  {
    name: "copy",
    args: "[number]",
    category: "Thông tin",
    description: "Copy the last assistant response to clipboard (usage: /copy [number])",
    vi: "Chép câu trả lời gần nhất của Hermes vào clipboard; thêm số để chép câu cũ hơn.",
    common: true,
  },
  {
    name: "save",
    args: "<json|md|html> [filename] [redact]",
    category: "Phiên",
    description: "Export the current conversation (bare /save shows usage) (usage: /save <json|md|html> [filename] [redact])",
    vi: "Xuất cuộc trò chuyện hiện tại ra json, md hoặc html; thêm 'redact' để che thông tin nhạy cảm.",
    common: true,
  },
  {
    name: "history",
    category: "Phiên",
    description: "Show conversation history",
    vi: "Xem lại lịch sử hội thoại của phiên.",
    common: true,
  },
  {
    name: "approvals",
    args: "[manual|smart|off]",
    category: "Cấu hình",
    description: "Show or set the persistent dangerous-command approval mode (usage: /approvals [manual|smart|off])",
    vi: "Xem hoặc đặt chế độ duyệt lệnh nguy hiểm: manual (hỏi mọi lệnh), smart (chỉ hỏi khi rủi ro), off (không hỏi).",
  },
  {
    name: "battery",
    args: "[on|off|status]",
    category: "Cấu hình",
    description: "Toggle a color-coded battery indicator in the status bar (usage: /battery [on|off|status])",
    vi: "Bật/tắt chỉ báo pin nhiều màu trên thanh trạng thái.",
  },
  {
    name: "busy",
    args: "[queue|steer|interrupt|status]",
    category: "Cấu hình",
    description: "Control how messages behave while Hermes is working (usage: /busy [queue|steer|interrupt|status])",
    vi: "Quyết định tin nhắn sẽ ra sao khi Hermes đang bận: xếp hàng, chen vào, hay ngắt hẳn.",
  },
  {
    name: "codex-runtime",
    aliases: ["codex_runtime"],
    args: "[auto|codex_app_server]",
    category: "Cấu hình",
    description: "Toggle codex app-server runtime for OpenAI/Codex models (usage: /codex-runtime [auto|codex_app_server])",
    vi: "Bật/tắt runtime codex app-server cho các mô hình OpenAI/Codex.",
  },
  {
    name: "config",
    category: "Cấu hình",
    description: "Show current configuration",
    vi: "Xem toàn bộ cấu hình hiện tại.",
  },
  {
    name: "export",
    args: "[profile] [-o output.tar.gz]",
    category: "Cấu hình",
    description: "Export a profile (config, skills, theme) to a shareable archive (usage: /export [profile] [-o output.tar.gz])",
    vi: "Xuất một hồ sơ (cấu hình, kỹ năng, giao diện) ra file nén để chia sẻ.",
  },
  {
    name: "fast",
    args: "[normal|fast|status] [--global]",
    category: "Cấu hình",
    description: "Toggle fast mode — OpenAI Priority Processing / Anthropic Fast Mode (Normal/Fast) (usage: /fast [normal|fast|status] [--global])",
    vi: "Bật/tắt chế độ nhanh — OpenAI Priority Processing hoặc Anthropic Fast Mode.",
  },
  {
    name: "focus",
    args: "[on|off|status]",
    category: "Cấu hình",
    description: "Toggle focus view — show only your prompt and the final response (usage: /focus [on|off|status])",
    vi: "Bật/tắt chế độ tập trung: chỉ hiện câu hỏi của anh và câu trả lời cuối, ẩn hết bước trung gian.",
  },
  {
    name: "footer",
    args: "[on|off|status]",
    category: "Cấu hình",
    description: "Toggle gateway runtime-metadata footer on final replies (usage: /footer [on|off|status])",
    vi: "Bật/tắt dòng chân trang kèm thông tin runtime của gateway dưới mỗi câu trả lời.",
  },
  {
    name: "import",
    args: "<archive.tar.gz> [--name <name>]",
    category: "Cấu hình",
    description: "Import a shared profile archive as a new profile (usage: /import <archive.tar.gz> [--name <name>])",
    vi: "Nhập một hồ sơ đã chia sẻ từ file nén thành hồ sơ mới.",
  },
  {
    name: "indicator",
    args: "[ascii|emoji|kaomoji|unicode]",
    category: "Cấu hình",
    description: "Pick the TUI busy-indicator style (usage: /indicator [ascii|emoji|kaomoji|unicode])",
    vi: "Chọn kiểu biểu tượng báo bận của giao diện: ascii, emoji, kaomoji hay unicode.",
  },
  {
    name: "personality",
    args: "[name]",
    category: "Cấu hình",
    description: "Set a predefined personality (usage: /personality [name])",
    vi: "Chọn một tính cách có sẵn cho Hermes.",
  },
  {
    name: "reasoning",
    args: "[level|show|hide|full|clamp] [--global]",
    category: "Cấu hình",
    description: "Manage reasoning effort and display (usage: /reasoning [level|show|hide|full|clamp] [--global])",
    vi: "Chỉnh mức độ suy luận và cách hiển thị suy luận.",
  },
  {
    name: "skin",
    args: "[name]",
    category: "Cấu hình",
    description: "Show or change the display skin/theme (usage: /skin [name])",
    vi: "Xem hoặc đổi giao diện màu.",
  },
  {
    name: "statusbar",
    aliases: ["sb"],
    category: "Cấu hình",
    description: "Toggle the context/model status bar",
    vi: "Bật/tắt thanh trạng thái hiện ngữ cảnh và mô hình.",
  },
  {
    name: "timestamps",
    aliases: ["ts"],
    args: "[on|off|status]",
    category: "Cấu hình",
    description: "Toggle [HH:MM] timestamps on messages and /history (usage: /timestamps [on|off|status])",
    vi: "Bật/tắt dấu thời gian [HH:MM] trên tin nhắn và trong /history.",
  },
  {
    name: "verbose",
    category: "Cấu hình",
    description: "Cycle tool progress display: off -> new -> all -> verbose",
    vi: "Đổi vòng mức hiển thị tiến trình công cụ: tắt → mới → tất cả → chi tiết.",
  },
  {
    name: "voice",
    args: "[on|off|tts|status]",
    category: "Cấu hình",
    description: "Toggle voice mode (usage: /voice [on|off|tts|status])",
    vi: "Bật/tắt chế độ giọng nói và đọc thành tiếng.",
  },
  {
    name: "wake",
    args: "[on|off|status]",
    category: "Cấu hình",
    description: "Toggle the 'Hey Hermes' wake word listener (usage: /wake [on|off|status])",
    vi: "Bật/tắt tính năng nghe từ khoá đánh thức 'Hey Hermes'.",
  },
  {
    name: "yolo",
    category: "Cấu hình",
    description: "Toggle YOLO mode (skip all dangerous command approvals)",
    vi: "Bật/tắt chế độ YOLO — bỏ qua mọi bước duyệt lệnh nguy hiểm.",
  },
  {
    name: "quit",
    aliases: ["exit"],
    args: "[--delete]",
    category: "Thoát",
    description: "Exit the CLI (use --delete to also remove session history) (usage: /quit [--delete])",
    vi: "Thoát CLI; thêm --delete để xoá luôn lịch sử phiên.",
  },
  {
    name: "debug",
    args: "[nous|local]",
    category: "Thông tin",
    description: "Upload debug report (system info + logs) and get shareable links (usage: /debug [nous|local])",
    vi: "Đóng gói báo cáo gỡ lỗi (thông tin hệ thống + log) rồi trả về link chia sẻ.",
  },
  {
    name: "diff",
    args: "[staged|all|session] [--stat] [path...]",
    category: "Thông tin",
    description: "Show git changes in the working directory (usage: /diff [staged|all|session] [--stat] [path...])",
    vi: "Xem thay đổi git trong thư mục làm việc; lọc theo staged/all/session hoặc đường dẫn.",
  },
  {
    name: "insights",
    args: "[days]",
    category: "Thông tin",
    description: "Show usage insights and analytics (usage: /insights [days])",
    vi: "Xem thống kê và phân tích mức sử dụng theo số ngày anh chọn.",
  },
  {
    name: "palette",
    category: "Thông tin",
    description: "Open the fuzzy command palette (also Ctrl+P)",
    vi: "Mở bảng lệnh tìm nhanh (tương đương Ctrl+P).",
  },
  {
    name: "paste",
    category: "Thông tin",
    description: "Attach clipboard image from your clipboard",
    vi: "Đính kèm ảnh đang nằm trong clipboard.",
  },
  {
    name: "platforms",
    aliases: ["gateway"],
    category: "Thông tin",
    description: "Show gateway/messaging platform status",
    vi: "Xem trạng thái gateway và các nền tảng nhắn tin đã nối.",
  },
  {
    name: "profile",
    category: "Thông tin",
    description: "Show active profile name and home directory",
    vi: "Xem tên hồ sơ đang dùng và thư mục gốc của nó.",
  },
  {
    name: "subscription",
    aliases: ["upgrade"],
    category: "Thông tin",
    description: "View your Nous plan and change it in the browser",
    vi: "Xem gói Nous của anh và đổi gói trên trình duyệt.",
    needsTerminal: true,
  },
  {
    name: "topup",
    category: "Thông tin",
    description: "Show your Nous balance and manage billing on the portal",
    vi: "Xem số dư Nous và quản lý thanh toán trên cổng dịch vụ.",
    needsTerminal: true,
  },
  {
    name: "update",
    category: "Thông tin",
    description: "Update Hermes Agent to the latest version",
    vi: "Cập nhật Hermes Agent lên bản mới nhất.",
  },
  {
    name: "version",
    aliases: ["v"],
    category: "Thông tin",
    description: "Show Hermes Agent version",
    vi: "Xem phiên bản Hermes Agent.",
  },
  {
    name: "whoami",
    category: "Thông tin",
    description: "Show your slash command access (admin / user)",
    vi: "Xem quyền dùng lệnh của anh là admin hay user.",
  },
  {
    name: "agents",
    aliases: ["tasks"],
    category: "Phiên",
    description: "Show active agents and running tasks",
    vi: "Xem các agent phụ đang chạy và tác vụ nền của chúng.",
    needsTerminal: true,
  },
  {
    name: "bg",
    args: "<prompt>",
    category: "Phiên",
    description: "Run a prompt in a separate background session (usage: /bg <prompt>)",
    vi: "Chạy một yêu cầu ở phiên nền riêng, không chiếm phiên đang trò chuyện.",
  },
  {
    name: "branch",
    aliases: ["fork"],
    args: "[name]",
    category: "Phiên",
    description: "Branch the current session (explore a different path) (usage: /branch [name])",
    vi: "Rẽ nhánh phiên hiện tại để thử một hướng khác mà không phá lịch sử gốc.",
  },
  {
    name: "btw",
    args: "<question>",
    category: "Phiên",
    description: "Ask a side question about the current conversation without interrupting it (usage: /btw <question>)",
    vi: "Hỏi xen một câu về cuộc trò chuyện hiện tại mà không làm gián đoạn mạch việc đang chạy.",
  },
  {
    name: "egress",
    args: "[status]",
    category: "Phiên",
    description: "Show Docker egress proxy status (usage: /egress [status])",
    vi: "Xem trạng thái proxy egress của Docker.",
  },
  {
    name: "goal",
    args: "[text | draft <text> | show | gate add <cmd> | pause | resume | clear | status | wait <pid> | unwait]",
    category: "Phiên",
    description: "Set a standing goal Hermes works on across turns until achieved (usage: /goal [text | draft <text> | show | gate add <cmd> | pause | resume | clear | status | wait <pid> | unwait])",
    vi: "Đặt một mục tiêu dài hạn để Hermes bám theo qua nhiều lượt cho tới khi xong; có thể tạm dừng, tiếp tục, xoá hoặc xem trạng thái.",
  },
  {
    name: "handoff",
    args: "<platform>",
    category: "Phiên",
    description: "Hand off this session to a messaging platform (Telegram, Discord, etc.) (usage: /handoff <platform>)",
    vi: "Chuyển phiên này sang một nền tảng nhắn tin như Telegram hay Discord.",
  },
  {
    name: "heartbeat",
    aliases: ["hb"],
    args: "[every <interval> <prompt> | status | pause | resume | clear]",
    category: "Phiên",
    description: "Set a recurring prompt that re-enters this session when idle (usage: /heartbeat [every <interval> <prompt> | status | pause | resume | clear])",
    vi: "Đặt một câu nhắc lặp lại, tự chạy lại trong phiên này mỗi khi rảnh.",
  },
  {
    name: "journey",
    aliases: ["learning", "memory-graph"],
    args: "[list|delete <id>|edit <id>]",
    category: "Phiên",
    description: "Open the learning journey timeline (usage: /journey [list|delete <id>|edit <id>])",
    vi: "Mở dòng thời gian hành trình học của Hermes; có thể xem, sửa hoặc xoá từng mục.",
    needsTerminal: true,
  },
  {
    name: "loop",
    aliases: ["proactive"],
    args: "[interval] <prompt> [--times N] [--until <condition>] | status | pause | resume | stop",
    category: "Phiên",
    description: "Re-run a prompt on a recurring interval in this session (usage: /loop [interval] <prompt> [--times N] [--until <condition>] | status | pause | resume | stop)",
    vi: "Chạy lặp một yêu cầu theo chu kỳ trong phiên này; giới hạn số lần bằng --times hoặc dừng theo điều kiện --until.",
  },
  {
    name: "moa",
    args: "<prompt>",
    category: "Phiên",
    description: "Run one prompt through the default Mixture of Agents preset, then restore your model (usage: /moa <prompt>)",
    vi: "Chạy một yêu cầu qua preset Mixture of Agents mặc định rồi trả mô hình về như cũ.",
  },
  {
    name: "plan",
    args: "[task]",
    category: "Phiên",
    description: "Write a markdown implementation plan to .hermes/plans/ without executing anything (usage: /plan [task])",
    vi: "Viết bản kế hoạch triển khai dạng markdown vào .hermes/plans/ mà không thực thi gì cả.",
  },
  {
    name: "prompt",
    aliases: ["compose"],
    args: "[initial text]",
    category: "Phiên",
    description: "Compose your next prompt in $EDITOR (markdown), then send it (usage: /prompt [initial text])",
    vi: "Soạn câu hỏi kế tiếp trong trình soạn thảo $EDITOR bằng markdown rồi gửi đi.",
  },
  {
    name: "redraw",
    category: "Phiên",
    description: "Force a full UI repaint (recovers from terminal drift)",
    vi: "Vẽ lại toàn bộ giao diện — cứu khi terminal bị lệch hoặc rác.",
  },
  {
    name: "refine",
    args: "[focus instructions]",
    category: "Phiên",
    description: "Review this conversation now and save lessons to memory/skills (usage: /refine [focus instructions])",
    vi: "Rà lại cuộc trò chuyện này ngay bây giờ và lưu những gì rút ra vào bộ nhớ hoặc kỹ năng.",
  },
  {
    name: "review",
    args: "[review instructions]",
    category: "Phiên",
    description: "Spawn an independent subagent to review the work just discussed (PR, code, docs) (usage: /review [review instructions])",
    vi: "Cử một agent phụ độc lập soi lại phần việc vừa bàn — PR, mã nguồn hay tài liệu.",
  },
  {
    name: "rollback",
    args: "[number] [--all]",
    category: "Phiên",
    description: "List or restore filesystem checkpoints (restores keep your hand-edits; --all overrides) (usage: /rollback [number] [--all])",
    vi: "Liệt kê hoặc khôi phục điểm lưu của hệ thống tệp; mặc định giữ lại phần anh tự sửa tay.",
  },
  {
    name: "snapshot",
    aliases: ["snap"],
    args: "[create|restore <id>|prune]",
    category: "Phiên",
    description: "Create or restore state snapshots of Hermes config/state (usage: /snapshot [create|restore <id>|prune])",
    vi: "Tạo hoặc khôi phục bản chụp cấu hình và trạng thái của Hermes.",
  },
  {
    name: "steer",
    args: "<prompt>",
    category: "Phiên",
    description: "Inject a message after the next tool call without interrupting (usage: /steer <prompt>)",
    vi: "Chèn một lời nhắc ngay sau lượt gọi công cụ kế tiếp mà không cắt ngang.",
  },
  {
    name: "subgoal",
    args: "[text | remove N | clear]",
    category: "Phiên",
    description: "Add or manage extra criteria on the active goal (usage: /subgoal [text | remove N | clear])",
    vi: "Thêm hoặc quản lý tiêu chí phụ cho mục tiêu đang chạy.",
  },
  {
    name: "title",
    args: "[name]",
    category: "Phiên",
    description: "Set a title for the current session (usage: /title [name])",
    vi: "Đặt tiêu đề cho phiên hiện tại.",
  },
  {
    name: "worktree",
    args: "[new [name]|list|prune [--dry-run]]",
    category: "Phiên",
    description: "Show, list, create, or prune isolated git worktrees (usage: /worktree [new [name]|list|prune [--dry-run]])",
    vi: "Xem, liệt kê, tạo hoặc dọn các worktree git tách biệt.",
  },
  {
    name: "density",
    category: "Giao diện",
    description: "Toggle compact display mode",
    vi: "Bật/tắt chế độ hiển thị gọn.",
  },
  {
    name: "logs",
    category: "Giao diện",
    description: "Show recent gateway log lines",
    vi: "Xem các dòng log gần đây của gateway.",
  },
  {
    name: "mouse",
    category: "Giao diện",
    description: "Set mouse tracking preset [on|off|toggle|wheel|buttons|all]",
    vi: "Đặt chế độ theo dõi chuột: on, off, toggle, wheel, buttons hoặc all.",
  },
  {
    name: "blueprint",
    aliases: ["bp"],
    args: "[name] [slot=value ...]",
    category: "Công cụ & Kỹ năng",
    description: "Set up an automation from a blueprint template (usage: /blueprint [name] [slot=value ...])",
    vi: "Dựng một tác vụ tự động từ mẫu blueprint có sẵn, điền tham số theo dạng slot=giá trị.",
  },
  {
    name: "browser",
    args: "[connect|disconnect|status|use]",
    category: "Công cụ & Kỹ năng",
    description: "Connect browser tools to your live Chromium-family browser via CDP, or switch to Browser Use mode (usage: /browser [connect|disconnect|status|use])",
    vi: "Nối công cụ trình duyệt vào Chrome/Chromium đang mở của anh qua CDP, hoặc chuyển sang chế độ Browser Use.",
  },
  {
    name: "bundles",
    category: "Công cụ & Kỹ năng",
    description: "List skill bundles (aliases /<name> for multiple skills)",
    vi: "Liệt kê các bộ kỹ năng (bundle) — mỗi bundle là một lệnh gọi gộp nhiều kỹ năng.",
  },
  {
    name: "cron",
    args: "[subcommand]",
    category: "Công cụ & Kỹ năng",
    description: "Manage scheduled tasks (usage: /cron [subcommand])",
    vi: "Quản lý các tác vụ chạy theo lịch.",
  },
  {
    name: "curator",
    args: "[subcommand]",
    category: "Công cụ & Kỹ năng",
    description: "Background skill maintenance (status, run, pin, archive, list-archived) (usage: /curator [subcommand])",
    vi: "Bảo trì kỹ năng chạy nền: xem trạng thái, chạy ngay, ghim, lưu trữ, xem kho lưu trữ.",
  },
  {
    name: "hatch",
    aliases: ["generate-pet"],
    args: "[description]",
    category: "Công cụ & Kỹ năng",
    description: "Generate a new petdex pet from a description (usage: /hatch [description])",
    vi: "Tạo một linh vật petdex mới từ mô tả của anh.",
  },
  {
    name: "init",
    args: "[notes]",
    category: "Công cụ & Kỹ năng",
    description: "Generate or update AGENTS.md project instructions from a repo scan (usage: /init [notes])",
    vi: "Quét kho mã rồi tạo hoặc cập nhật file hướng dẫn dự án AGENTS.md.",
  },
  {
    name: "kanban",
    args: "[subcommand]",
    category: "Công cụ & Kỹ năng",
    description: "Multi-profile collaboration board (tasks, links, comments) (usage: /kanban [subcommand])",
    vi: "Bảng cộng tác nhiều hồ sơ: tác vụ, liên kết và bình luận.",
  },
  {
    name: "learn",
    args: "<what to learn from>",
    category: "Công cụ & Kỹ năng",
    description: "Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes) (usage: /learn <what to learn from>)",
    vi: "Học một kỹ năng dùng lại được từ bất cứ nguồn nào anh chỉ: thư mục, URL, chính cuộc trò chuyện này, hay ghi chú.",
  },
  {
    name: "memory",
    args: "[pending|approve|reject|approval] [id|on|off]",
    category: "Công cụ & Kỹ năng",
    description: "Review pending memory writes / toggle the approval gate (usage: /memory [pending|approve|reject|approval] [id|on|off])",
    vi: "Duyệt các ghi nhớ đang chờ ghi và bật/tắt cổng phê duyệt ghi nhớ.",
  },
  {
    name: "pet",
    args: "[toggle|list|scale <n>|<slug>]",
    category: "Công cụ & Kỹ năng",
    description: "Toggle or adopt a petdex mascot (/pet, /pet list, /pet <slug>) (usage: /pet [toggle|list|scale <n>|<slug>])",
    vi: "Bật/tắt hoặc nhận nuôi linh vật petdex; có thể xem danh sách và chỉnh cỡ.",
    needsTerminal: true,
  },
  {
    name: "plugins",
    category: "Công cụ & Kỹ năng",
    description: "List installed plugins and their status",
    vi: "Liệt kê tiện ích đã cài và trạng thái của chúng.",
    needsTerminal: true,
  },
  {
    name: "reload",
    category: "Công cụ & Kỹ năng",
    description: "Reload .env variables into the running session",
    vi: "Nạp lại các biến trong .env vào phiên đang chạy.",
  },
  {
    name: "reload-mcp",
    aliases: ["reload_mcp"],
    category: "Công cụ & Kỹ năng",
    description: "Reload MCP servers from config",
    vi: "Nạp lại các máy chủ MCP từ cấu hình.",
  },
  {
    name: "reload-skills",
    aliases: ["reload_skills"],
    category: "Công cụ & Kỹ năng",
    description: "Re-scan ~/.hermes/skills/ for newly installed or removed skills",
    vi: "Quét lại thư mục kỹ năng để nhận kỹ năng mới cài hoặc vừa gỡ.",
  },
  {
    name: "suggestions",
    aliases: ["suggest"],
    args: "[accept|dismiss N | catalog]",
    category: "Công cụ & Kỹ năng",
    description: "Review suggested automations (accept/dismiss) (usage: /suggestions [accept|dismiss N | catalog])",
    vi: "Duyệt các tác vụ tự động được gợi ý — chấp nhận hoặc bỏ qua.",
  },
  {
    name: "tools",
    args: "[list|disable|enable] [name...]",
    category: "Công cụ & Kỹ năng",
    description: "Manage tools: /tools [list|disable|enable] [name...] (usage: /tools [list|disable|enable] [name...])",
    vi: "Quản lý công cụ: liệt kê, bật hoặc tắt từng công cụ.",
  },
  {
    name: "toolsets",
    category: "Công cụ & Kỹ năng",
    description: "List available toolsets",
    vi: "Liệt kê các bộ công cụ có sẵn.",
  },
];

/** True while the composer holds a command name still being typed. */
export function isCommandQuery(text: string): boolean {
  return /^\/[A-Za-z0-9-]*$/.test(text);
}

/**
 * Commands matching `query` (with or without its leading slash): exact first,
 * then name prefixes, then aliases and descriptions.
 */
export function matchCommands(
  query: string,
  commands: HermesCommand[] = HERMES_COMMANDS,
): HermesCommand[] {
  const needle = query.replace(/^\//, "").toLocaleLowerCase();
  if (!needle) return commands;

  const scored: Array<{ command: HermesCommand; score: number }> = [];
  for (const command of commands) {
    const name = command.name.toLocaleLowerCase();
    const aliases = (command.aliases ?? []).map((a) => a.toLocaleLowerCase());
    let score = -1;
    if (name === needle) score = 0;
    else if (name.startsWith(needle)) score = 1;
    else if (aliases.some((a) => a === needle || a.startsWith(needle))) score = 2;
    else if (name.includes(needle)) score = 3;
    else if (command.description.toLocaleLowerCase().includes(needle)) score = 4;
    else if (command.vi.toLocaleLowerCase().includes(needle)) score = 5;
    if (score >= 0) scored.push({ command, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score || a.command.name.localeCompare(b.command.name),
    )
    .map((entry) => entry.command);
}

/** The command a composer line invokes, if any. */
export function commandForLine(
  text: string,
  commands: HermesCommand[] = HERMES_COMMANDS,
): HermesCommand | null {
  const match = text.trim().match(/^\/([A-Za-z0-9-]+)/);
  if (!match) return null;
  const needle = match[1].toLocaleLowerCase();
  return (
    commands.find(
      (command) =>
        command.name.toLocaleLowerCase() === needle ||
        (command.aliases ?? []).some((a) => a.toLocaleLowerCase() === needle),
    ) ?? null
  );
}
