import { describe, expect, it } from "vitest";

import {
  ANSI_ESCAPE_RE,
  attachedFileLine,
  basename,
  buildTurnLines,
  chunkForPty,
  formatBytes,
  highestImageToken,
  imagePathsInMessage,
  parseMessageAttachments,
  releaseSocketRef,
  uploadFileName,
} from "./chat-composer";

describe("highestImageToken", () => {
  it("finds the highest index in a repainted composer frame", () => {
    expect(highestImageToken("prompt [[ Image 1 ]] and [[ Image 2 ]]")).toBe(2);
  });

  it("tolerates the TUI's spacing", () => {
    expect(highestImageToken("[[Image 3]]")).toBe(3);
  });

  it("returns 0 when no token is present", () => {
    expect(highestImageToken("no tokens here")).toBe(0);
  });

  it("does not advance on a redraw of an older token", () => {
    expect(highestImageToken("[[ Image 1 ]] [[ Image 1 ]]")).toBe(1);
  });

  it("reads the token out of a styled Ink repaint", () => {
    const painted = "\u001b[38;5;180m[[ Image 2 ]]\u001b[39m";
    expect(highestImageToken(painted.replace(ANSI_ESCAPE_RE, ""))).toBe(2);
  });
});

describe("chunkForPty", () => {
  it("keeps a short line in a single frame", () => {
    expect(chunkForPty("hello", 480)).toEqual(["hello"]);
  });

  it("emits nothing for an empty line rather than an empty frame", () => {
    expect(chunkForPty("", 480)).toEqual([]);
  });

  it("splits on code points, never mid surrogate pair", () => {
    const line = "😀😀😀😀";
    expect(chunkForPty(line, 2)).toEqual(["😀😀", "😀😀"]);
  });

  it("round-trips Vietnamese text across boundaries", () => {
    const line = "Đọc tệp đính kèm giúp anh nhé";
    expect(chunkForPty(line, 5).join("")).toBe(line);
  });
});

describe("buildTurnLines", () => {
  it("puts file references before the instruction", () => {
    expect(buildTurnLines("Tóm tắt giúp anh", ["D:\\a\\b.pdf"])).toEqual([
      "[User attached file: D:\\a\\b.pdf]",
      "Tóm tắt giúp anh",
    ]);
  });

  it("sends the reference alone when there is no text", () => {
    expect(buildTurnLines("", ["/tmp/x.csv"])).toEqual([
      "[User attached file: /tmp/x.csv]",
    ]);
  });

  it("keeps interior blank lines but drops trailing ones", () => {
    expect(buildTurnLines("a\n\nb\n\n", [])).toEqual(["a", "", "b"]);
  });

  it("normalises CRLF so no stray Return submits early", () => {
    expect(buildTurnLines("a\r\nb", [])).toEqual(["a", "b"]);
  });
});

describe("uploadFileName", () => {
  const at = new Date("2026-08-31T00:21:11.123Z");

  it("strips characters Windows rejects", () => {
    expect(uploadFileName('bao:cao*"1".pdf', at)).toBe(
      "bao_cao__1__20260831002111.pdf",
    );
  });

  it("keeps the extension after the stamp", () => {
    expect(uploadFileName("report.pdf", at)).toBe("report_20260831002111.pdf");
  });

  it("handles a name with no extension", () => {
    expect(uploadFileName("README", at)).toBe("README_20260831002111");
  });

  it("still yields a usable name when every character is illegal", () => {
    expect(uploadFileName("///", at)).toBe("____20260831002111");
  });

  it("falls back to a default stem for an empty name", () => {
    expect(uploadFileName("   ", at)).toBe("tep-dinh-kem_20260831002111");
  });
});

describe("parseMessageAttachments", () => {
  it("lifts the TUI's file line out of the bubble text", () => {
    const parsed = parseMessageAttachments(
      `${attachedFileLine("D:\\HERMES AGENT\\chat_uploads\\bao-cao.pdf")}\nTóm tắt giúp anh`,
    );
    expect(parsed.text).toBe("Tóm tắt giúp anh");
    expect(parsed.attachments).toEqual([{ kind: "file", label: "bao-cao.pdf" }]);
  });

  it("turns image tokens into chips", () => {
    const parsed = parseMessageAttachments("[[ Image 1 ]] mô tả ảnh này");
    expect(parsed.attachments).toEqual([{ kind: "image", label: "Ảnh 1" }]);
    expect(parsed.text).toBe("mô tả ảnh này");
  });

  it("recognises the image line the gateway inserts on a drop", () => {
    const parsed = parseMessageAttachments("[User attached image: anh.png]");
    expect(parsed.attachments).toEqual([{ kind: "image", label: "anh.png" }]);
    expect(parsed.text).toBe("");
  });

  it("leaves ordinary text untouched", () => {
    const parsed = parseMessageAttachments("chào em");
    expect(parsed.text).toBe("chào em");
    expect(parsed.attachments).toHaveLength(0);
  });
});

describe("formatBytes", () => {
  it("formats each magnitude", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(0)).toBe("");
  });
});

describe("releaseSocketRef", () => {
  it("clears the ref when the closing socket is still the current one", () => {
    const socket = { id: "a" };
    const ref = { current: socket as { id: string } | null };
    releaseSocketRef(ref, socket);
    expect(ref.current).toBeNull();
  });

  it("leaves a newer socket alone when a stale close arrives late", () => {
    const stale = { id: "old" };
    const live = { id: "new" };
    const ref = { current: live as { id: string } | null };
    releaseSocketRef(ref, stale);
    expect(ref.current).toBe(live);
  });

  it("is a no-op once the ref is already empty", () => {
    const ref = { current: null as { id: string } | null };
    releaseSocketRef(ref, { id: "old" });
    expect(ref.current).toBeNull();
  });
});

describe("imagePathsInMessage", () => {
  it("finds a Windows path that contains spaces", () => {
    const content =
      "Ảnh nằm ở đây nè anh:\n" +
      "`D:\\HERMES AGENT\\cache\\images\\openai_gpt-image-2-medium_20260831_075549_134f8bb3.png`\n" +
      "Anh xem thử nha!";
    expect(imagePathsInMessage(content)).toEqual([
      "D:\\HERMES AGENT\\cache\\images\\openai_gpt-image-2-medium_20260831_075549_134f8bb3.png",
    ]);
  });

  it("finds a POSIX path", () => {
    expect(imagePathsInMessage("saved to /home/a/b/plot.PNG now")).toEqual([
      "/home/a/b/plot.PNG",
    ]);
  });

  it("deduplicates a path repeated in one message", () => {
    const content = "C:/tmp/a.png rồi lại C:/tmp/a.png";
    expect(imagePathsInMessage(content)).toEqual(["C:/tmp/a.png"]);
  });

  it("ignores prose and non-image files", () => {
    expect(imagePathsInMessage("chỉ là chữ thường thôi")).toEqual([]);
    expect(imagePathsInMessage("D:\\a\\bao-cao.pdf")).toEqual([]);
  });

  it("does not swallow the words around a bare slash", () => {
    expect(imagePathsInMessage("tỉ lệ 3/4 và ảnh /tmp/x.png")).toEqual([
      "/tmp/x.png",
    ]);
  });
});

describe("basename", () => {
  it("handles both separators", () => {
    expect(basename("D:\\HERMES AGENT\\images\\a b.png")).toBe("a b.png");
    expect(basename("/home/a/b.png")).toBe("b.png");
  });
});
