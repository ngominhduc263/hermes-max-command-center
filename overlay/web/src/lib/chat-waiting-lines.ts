/**
 * Waiting lines for the chat's "Đồng bộ Terminal: tắt" mode.
 *
 * With syncing off the bubble deliberately does not stream — a slow thinking
 * model dribbling one word a second is more distracting than silence. But
 * silence followed by a wall of text reads like the app froze, so the bubble
 * keeps a light-hearted line going instead, rotated every few seconds and
 * paired with the real character count so it still carries actual progress.
 *
 * Every line opens with an emoji: the emoji changing is what says "still
 * alive" at a glance, even when nobody is reading the words. Fifty of them, so
 * a long thinking turn does not start repeating itself before it finishes.
 */

export const WAITING_LINES: string[] = [
  "🏃 Đang chạy lon ton…",
  "💪 Cố lên, sắp xong rồi!",
  "💣 Chuẩn bị bùm bùm nè…",
  "🍚 Ăn cơm đi, còn lâu lắm…",
  "🧠 Đang vắt óc suy nghĩ…",
  "🚶 Chữ đang xếp hàng vào chỗ…",
  "⌨️ Em gõ nhanh nhất có thể rồi đó…",
  "🔍 Đang lục lọi trí nhớ…",
  "🙌 Sắp có rồi, anh đừng đi đâu nha…",
  "🍽️ Đang nhấm nháp chút dữ liệu…",
  "🤔 Nghĩ hơi lâu tí, nhưng nghĩ kỹ…",
  "👟 Đang buộc lại dây giày rồi chạy tiếp…",
  "🧺 Chờ em xíu, đang gom ý…",
  "🍳 Đang xào nấu câu trả lời…",
  "🐜 Bận rộn như kiến tha mồi…",
  "🖋️ Đang chấm bút vào mực…",
  "🎬 Sắp tới đoạn hay rồi đó…",
  "🧮 Em đang tính nhẩm, đừng làm em rối…",
  "🥁 Đang gõ lạch cạch trong đầu…",
  "💧 Uống ngụm nước rồi em kể tiếp…",
  "📐 Đang xếp chữ cho ngay hàng thẳng lối…",
  "🍠 Từ từ khoai sẽ nhừ…",
  "⏰ Đang chạy deadline nội bộ…",
  "✅ Nghĩ xong đoạn này là xong à…",
  "🧹 Đang dọn dẹp mấy ý thừa…",
  "🐢 Chậm mà chắc nha anh…",
  "🎈 Đang thổi phồng bong bóng ý tưởng…",
  "🔥 Sắp ra lò, còn nóng hổi…",
  "👀 Em vẫn ở đây, chưa ngủ quên đâu…",
  "🎀 Đang buộc nơ cho câu cuối…",
  "🐌 Ốc sên cũng đang cổ vũ em nè…",
  "☕ Làm ngụm cà phê cho tỉnh cái đã…",
  "🧶 Đang gỡ rối cuộn len ý tưởng…",
  "🚧 Công trường đang thi công, đừng bấm còi…",
  "🔮 Đang soi quả cầu xem viết gì tiếp…",
  "📦 Đang đóng gói chữ vào thùng…",
  "🎣 Thả câu, chờ ý hay cắn câu…",
  "🧊 Bình tĩnh, mát mẻ, sắp xong…",
  "🛠️ Đang siết lại mấy con ốc trong câu…",
  "🎨 Đang tô màu cho đoạn kết…",
  "🚀 Đếm ngược… ba, hai, một…",
  "🧭 Đang dò đường về câu trả lời…",
  "🪄 Ba giây nữa là có phép màu…",
  "🐝 Chăm như ong, anh chờ em nha…",
  "📚 Đang lật tới trang cuối…",
  "🎯 Đang ngắm cho trúng ý anh hỏi…",
  "🧩 Còn một mảnh ghép nữa thôi…",
  "🍜 Chờ như chờ tô phở nóng — đáng mà…",
  "🌱 Ý tưởng đang nảy mầm, đừng giẫm…",
  "🎁 Gói xong là em đưa liền nè…",
];

/**
 * The line to show at `tick`, offset by `seed` so two turns in a row do not
 * open with the same one. Pure and total: any integers are fine.
 */
export function waitingLineAt(
  seed: number,
  tick: number,
  lines: string[] = WAITING_LINES,
): string {
  if (!lines.length) return "";
  const size = lines.length;
  const index = (((seed + tick) % size) + size) % size;
  return lines[index];
}

/** How long one line stays up before the next takes over. */
export const WAITING_LINE_MS = 4200;
