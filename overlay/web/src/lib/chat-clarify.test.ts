import { describe, expect, it } from "vitest";

import {
  answeredCount,
  buildAnswer,
  buildClarifyResponse,
  EMPTY_DRAFT,
  isAnswered,
  isOtherChoice,
  parseClarifyExpire,
  parseClarifyRequest,
  progressVi,
  splitRecommended,
  toggleChoice,
  usableChoices,
  type ClarifyDraft,
} from "./chat-clarify";

/**
 * A clarify blocks the entire turn until it is answered, so the failure mode
 * here is not a cosmetic one: a card that sends the wrong answer string leaves
 * Hermes stuck, or resumes it on a decision the user did not make. The payload
 * shapes below are the ones `_clarify_block` actually emits.
 */

describe("parseClarifyRequest — batch shape", () => {
  const batch = {
    questions: [
      {
        choices: ["1 Code + 1 Research (Recommended)", "1 Ops + 1 Research", "Other"],
        multi_select: false,
        qid: "q1",
        question: "Đặt vai cho 2 em thế nào?",
      },
      { choices: [], multi_select: false, qid: "q2", question: "Tên 2 em thì sao?" },
    ],
    request_id: "req-1",
  };

  it("reads the question list the batch form sends", () => {
    const parsed = parseClarifyRequest(batch);
    expect(parsed).toMatchObject({ batch: true, requestId: "req-1" });
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.questions[0].qid).toBe("q1");
  });

  it("drops an entry with no qid, which could never be answered", () => {
    // The server rejects an unknown question_id, so a qid-less entry is a
    // button that can only ever fail.
    const parsed = parseClarifyRequest({
      questions: [{ question: "không có qid" }, batch.questions[0]],
      request_id: "req-1",
    });
    expect(parsed?.questions).toHaveLength(1);
  });

  it("keeps choice labels verbatim, suffix and all", () => {
    // The tool strips "(Recommended)" itself; re-writing it here would send
    // back a label the tool never offered.
    expect(parseClarifyRequest(batch)?.questions[0].choices[0]).toBe(
      "1 Code + 1 Research (Recommended)",
    );
  });
});

describe("parseClarifyRequest — single shape", () => {
  it("reads the historical single-question payload", () => {
    const parsed = parseClarifyRequest({
      choices: ["Có", "Không"],
      question: "Chạy tiếp chứ?",
      request_id: "req-2",
    });
    expect(parsed).toMatchObject({ batch: false, requestId: "req-2" });
    expect(parsed?.questions[0]).toMatchObject({ qid: "", question: "Chạy tiếp chứ?" });
  });

  it("carries the multi-select hint when it is set", () => {
    const parsed = parseClarifyRequest({
      choices: ["a", "b"],
      multi_select: true,
      question: "Chọn mấy cái?",
      request_id: "req-3",
    });
    expect(parsed?.questions[0].multiSelect).toBe(true);
  });

  it("accepts an open-ended question with no choices at all", () => {
    const parsed = parseClarifyRequest({
      question: "Đặt tên là gì?",
      request_id: "req-4",
    });
    expect(parsed?.questions[0].choices).toEqual([]);
  });

  it("refuses a payload it could not answer", () => {
    expect(parseClarifyRequest({ question: "hỏi gì đó" })).toBeNull();
    expect(parseClarifyRequest({ request_id: "req-5" })).toBeNull();
    expect(parseClarifyRequest(null)).toBeNull();
  });
});

describe("parseClarifyExpire", () => {
  it("names the request that timed out", () => {
    expect(parseClarifyExpire({ request_id: "req-1" })).toBe("req-1");
    expect(parseClarifyExpire(null)).toBe("");
  });
});

describe("toggleChoice", () => {
  it("replaces the pick in single-select", () => {
    let draft = toggleChoice(EMPTY_DRAFT, "A", false);
    draft = toggleChoice(draft, "B", false);
    expect(draft.selected).toEqual(["B"]);
  });

  it("lets a single-select pick be undone", () => {
    const draft = toggleChoice(toggleChoice(EMPTY_DRAFT, "A", false), "A", false);
    expect(draft.selected).toEqual([]);
  });

  it("accumulates in multi-select and toggles each off again", () => {
    let draft = toggleChoice(EMPTY_DRAFT, "A", true);
    draft = toggleChoice(draft, "B", true);
    expect(draft.selected).toEqual(["A", "B"]);
    draft = toggleChoice(draft, "A", true);
    expect(draft.selected).toEqual(["B"]);
  });
});

describe("buildAnswer", () => {
  const single = { choices: ["A", "B"], multiSelect: false, qid: "q", question: "?" };
  const multi = { choices: ["A", "B"], multiSelect: true, qid: "q", question: "?" };

  it("sends the choice label verbatim for a single pick", () => {
    expect(buildAnswer(single, { custom: "", selected: ["A (Recommended)"] })).toBe(
      "A (Recommended)",
    );
  });

  it("sends a JSON array for multi-select", () => {
    // A label can contain a comma, which the comma-separated fallback would
    // split in the wrong place.
    expect(buildAnswer(multi, { custom: "", selected: ["A, một", "B"] })).toBe(
      '["A, một","B"]',
    );
  });

  it("lets typed text win over a stale selection", () => {
    expect(buildAnswer(single, { custom: " tự nhập ", selected: ["A"] })).toBe(
      "tự nhập",
    );
  });

  it("returns nothing when the person has not decided", () => {
    expect(buildAnswer(single, EMPTY_DRAFT)).toBe("");
  });
});

describe("buildClarifyResponse", () => {
  const request = {
    batch: true,
    questions: [{ choices: ["A"], multiSelect: false, qid: "q1", question: "?" }],
    requestId: "req-1",
  };

  it("names the question, because a batch is answered one at a time", () => {
    expect(
      buildClarifyResponse(request, request.questions[0], {
        custom: "",
        selected: ["A"],
      }),
    ).toEqual({ answer: "A", question_id: "q1", request_id: "req-1" });
  });

  it("omits question_id for a single-question clarify", () => {
    // Sending one would make the server look for a batch that does not exist.
    const single = {
      batch: false,
      questions: [{ choices: ["A"], multiSelect: false, qid: "", question: "?" }],
      requestId: "req-2",
    };
    expect(
      buildClarifyResponse(single, single.questions[0], {
        custom: "",
        selected: ["A"],
      }),
    ).toEqual({ answer: "A", request_id: "req-2" });
  });
});

describe("progress", () => {
  const request = parseClarifyRequest({
    questions: [
      { choices: [], qid: "q1", question: "một" },
      { choices: [], qid: "q2", question: "hai" },
      { choices: [], qid: "q3", question: "ba" },
    ],
    request_id: "req-1",
  })!;

  it("counts only questions that actually have an answer", () => {
    const drafts: Record<string, ClarifyDraft> = {
      q1: { custom: "xong", selected: [] },
      q2: { custom: "   ", selected: [] },
    };
    expect(answeredCount(request, drafts)).toBe(1);
    expect(progressVi(request, drafts)).toBe("1/3 câu đã trả lời");
  });

  it("words a single question as a wait, not a score", () => {
    const one = parseClarifyRequest({
      choices: ["A"],
      question: "một câu thôi",
      request_id: "req-2",
    })!;
    expect(progressVi(one, {})).toContain("đang chờ");
    expect(progressVi(one, { single: { custom: "", selected: ["A"] } })).toContain(
      "bấm gửi",
    );
  });

  it("treats whitespace as unanswered", () => {
    expect(isAnswered({ custom: "  ", selected: [] })).toBe(false);
    expect(isAnswered({ custom: "", selected: ["A"] })).toBe(true);
  });
});

describe("splitRecommended", () => {
  it("pulls Hermes's own suggestion out for a badge", () => {
    expect(splitRecommended("1 Code + 1 Research (Recommended)")).toEqual({
      label: "1 Code + 1 Research",
      recommended: true,
    });
  });

  it("leaves an ordinary label alone", () => {
    expect(splitRecommended("Cả 2 đều là bot code")).toEqual({
      label: "Cả 2 đều là bot code",
      recommended: false,
    });
  });

  it("does not mistake a parenthetical for a recommendation", () => {
    expect(splitRecommended("Chạy nền (không chặn)").recommended).toBe(false);
  });
});

describe("usableChoices / isOtherChoice", () => {
  it("recognises the runtime's free-text option", () => {
    expect(isOtherChoice("Other (type your answer)")).toBe(true);
    expect(isOtherChoice("Otherwise keep going")).toBe(false);
    expect(isOtherChoice("Khác")).toBe(false);
  });

  it("turns the Other option into a text box rather than a dead button", () => {
    const { allowCustom, choices } = usableChoices({
      choices: ["A", "B", "Other (type your answer)"],
      multiSelect: false,
      qid: "q",
      question: "?",
    });
    expect(choices).toEqual(["A", "B"]);
    expect(allowCustom).toBe(true);
  });

  it("keeps a fixed choice list closed when no Other was offered", () => {
    expect(
      usableChoices({
        choices: ["A", "B"],
        multiSelect: false,
        qid: "q",
        question: "?",
      }).allowCustom,
    ).toBe(false);
  });

  it("always allows text for an open-ended question", () => {
    expect(
      usableChoices({ choices: [], multiSelect: false, qid: "q", question: "?" })
        .allowCustom,
    ).toBe(true);
  });
});
