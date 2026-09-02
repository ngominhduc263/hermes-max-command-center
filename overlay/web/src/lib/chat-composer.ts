/**
 * Pure helpers for the dashboard's structured chat composer.
 *
 * The rich chat is a second face on the SAME `hermes --tui` PTY the Terminal
 * view drives, so every message it sends has to survive Ink's stdin tokenizer.
 * Two rules, both learned the hard way:
 *
 *  1. NEVER paste a multi-line block and press Return on a timer.
 *     `Terminal.paste()` turns "\n" into "\r" — which submits early when the
 *     TUI has bracketed paste off — and, when it is on, routes the payload
 *     through the TUI's async paste handler. That handler resolves
 *     `image.attach` / `input.detect_drop` over the gateway RPC and then
 *     *overwrites* the composer with a snapshot taken before our text arrived
 *     (`appendAttachment` in ui-tui/src/app/useComposerState.ts). A Return
 *     that lands mid-flight submits whatever fragment is left in the buffer,
 *     which is how an attached file used to reach the agent as a stray letter.
 *
 *  2. Type instead. A frame with no newline is a plain printable insert
 *     (synchronous); a lone "\n" inserts a line break; a lone "\r" submits.
 *     That is the same path the upstream `?learn=` seed uses.
 *
 *  3. Stage an image the way a drag-and-drop does: paste the bare path. The
 *     TUI recognises it (`looksLikeDroppedPath`), registers it on the session
 *     through `image.attach` and drops a `[[ Image N ]]` token where the path
 *     was — and that commit runs through `emitPaste`, which carries an
 *     edit-version guard. NOT `/image <path>` + Return: that route goes through
 *     `appendAttachment`, which snapshots the composer, awaits the RPC and
 *     writes `snapshot + token` back unconditionally. Against a local gateway
 *     the reply beats Ink's re-render, so the snapshot still holds the command
 *     line and the whole `/image <path>` string lands back in the composer.
 *
 * The page waits for that token before typing anything else. Non-image files
 * need no round trip at all: `[User attached file: …]` is verbatim what
 * `input.detect_drop` would have inserted.
 */

/** Longest run of characters sent in one PTY frame. */
export const PTY_TEXT_CHUNK_CHARS = 480;

/**
 * CSI / OSC / two-byte escapes. Ink repaints its composer constantly, so a
 * token the page waits for arrives wrapped in styling.
 */
/* eslint-disable-next-line no-control-regex -- PTY output is raw terminal data */
export const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

const IMAGE_TOKEN_RE = /\[\[\s*Image\s+(\d+)\s*\]\]/g;

/** The line the TUI's own drop handler inserts for a non-image attachment. */
export function attachedFileLine(path: string): string {
  return `[User attached file: ${path}]`;
}

/** Highest `[[ Image N ]]` index visible in a chunk of PTY output, or 0. */
export function highestImageToken(text: string): number {
  let max = 0;
  IMAGE_TOKEN_RE.lastIndex = 0;
  let match = IMAGE_TOKEN_RE.exec(text);
  while (match) {
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index > max) max = index;
    match = IMAGE_TOKEN_RE.exec(text);
  }
  return max;
}

/** Split a line into code points so a frame boundary never breaks a glyph. */
export function chunkForPty(
  line: string,
  size = PTY_TEXT_CHUNK_CHARS,
): string[] {
  const points = Array.from(line);
  if (!points.length) return [];
  if (points.length <= size) return [line];
  const chunks: string[] = [];
  for (let i = 0; i < points.length; i += size) {
    chunks.push(points.slice(i, i + size).join(""));
  }
  return chunks;
}

/**
 * The lines to type for one turn: file references first (so the agent reads
 * the attachment before the instruction), then the user's own text.
 */
export function buildTurnLines(text: string, filePaths: string[]): string[] {
  const lines = [
    ...filePaths.map(attachedFileLine),
    ...text.replace(/\r\n?/g, "\n").split("\n"),
  ];
  // Drop trailing blank lines — they would submit the turn one Return early.
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/** Windows- and POSIX-safe upload name, collision-proofed with a stamp. */
export function uploadFileName(original: string, now = new Date()): string {
  const cleaned = original
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned || "tep-dinh-kem";
  // yyyymmddhhmmss — digits only, so no stray "." or "Z" is glued on.
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const dot = safe.lastIndexOf(".");
  return dot > 0
    ? `${safe.slice(0, dot)}_${stamp}${safe.slice(dot)}`
    : `${safe}_${stamp}`;
}

export interface ParsedMessage {
  text: string;
  attachments: Array<{ kind: "image" | "file"; label: string }>;
}

const ATTACHMENT_LINE_RE = /^\s*\[User attached (file|image):\s*(.+?)\]\s*$/i;

/**
 * Attachment markers are part of the prompt the agent receives, so the session
 * history replays them back. Lift them out and render chips instead of leaving
 * raw markup inside the bubble.
 */
export function parseMessageAttachments(content: string): ParsedMessage {
  const attachments: ParsedMessage["attachments"] = [];
  const kept: string[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(ATTACHMENT_LINE_RE);
    if (match) {
      const raw = match[2].trim();
      attachments.push({
        kind: match[1].toLowerCase() === "image" ? "image" : "file",
        label: raw.split(/[\\/]/).pop() || raw,
      });
      continue;
    }
    kept.push(line);
  }

  let text = kept.join("\n");
  const tokens = text.match(IMAGE_TOKEN_RE);
  if (tokens) {
    tokens.forEach((_token, index) => {
      attachments.push({ kind: "image", label: `Ảnh ${index + 1}` });
    });
    text = text.replace(IMAGE_TOKEN_RE, "");
  }

  return { attachments, text: text.trim() };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Disown a socket ref only when it still points at `socket`.
 *
 * A WebSocket close event is delivered in a later task than `close()`, so on a
 * reconnect — new chat, session switch, a blip on the wire — the effect has
 * often already stored the replacement socket by the time the old socket's
 * `onclose` runs. Clearing the ref unconditionally there wiped a live
 * connection: the terminal kept working (its writer closes over its own socket)
 * while every ref-based feature reported "not connected" until a page reload.
 */
export function releaseSocketRef<T>(
  ref: { current: T | null },
  socket: T,
): void {
  if (ref.current === socket) ref.current = null;
}

/* ── Image paths inside a message ─────────────────────────────────────────
 *
 * Hermes answers "the image is at <path>" rather than embedding anything, so
 * the dashboard finds those paths itself and renders them through
 * `GET /api/media` (which serves HERMES_HOME/{images,screenshots,cache}).
 *
 * Windows paths routinely contain spaces (`D:\HERMES AGENT\...`), so the
 * drive-letter form matches lazily up to the extension instead of stopping at
 * the first space. The bare-POSIX form stays space-free: starting a lazy match
 * at any "/" in a sentence would swallow the words around it.
 */
const WINDOWS_IMAGE_PATH_RE =
  /[A-Za-z]:[\\/][^\n"'`<>|*?]*?\.(?:png|jpe?g|gif|webp|bmp)/gi;
// The POSIX form must start at a real boundary, or a lazy match would begin at
// any "/" inside a word. The leading character is captured, not consumed.
const POSIX_IMAGE_PATH_RE =
  /(?:^|[\s(["'`])((?:\/|~\/)[^\s"'`<>|*?]+\.(?:png|jpe?g|gif|webp|bmp))/gi;

/** Absolute image paths mentioned in a message, in order, deduplicated. */
export function imagePathsInMessage(content: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const path = raw.trim();
    const key = path.toLocaleLowerCase();
    if (!path || seen.has(key)) return;
    seen.add(key);
    found.push(path);
  };

  WINDOWS_IMAGE_PATH_RE.lastIndex = 0;
  let windows = WINDOWS_IMAGE_PATH_RE.exec(content);
  while (windows) {
    add(windows[0]);
    windows = WINDOWS_IMAGE_PATH_RE.exec(content);
  }

  // Blank out what the drive-letter pass already claimed: "C:/tmp/a.png"
  // otherwise yields a phantom second hit for its "/tmp/a.png" tail.
  const remaining = content.replace(WINDOWS_IMAGE_PATH_RE, " ");
  POSIX_IMAGE_PATH_RE.lastIndex = 0;
  let posix = POSIX_IMAGE_PATH_RE.exec(remaining);
  while (posix) {
    add(posix[1]);
    posix = POSIX_IMAGE_PATH_RE.exec(remaining);
  }

  return found;
}

/** Trailing file name of a path, for captions. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
