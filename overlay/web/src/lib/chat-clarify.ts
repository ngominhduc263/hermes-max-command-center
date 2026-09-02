/**
 * "Hermes đang hỏi lại" — the `clarify` tool's question card.
 *
 * When Hermes needs a decision it cannot make for you, it calls the `clarify`
 * tool, which **blocks the whole turn** and waits. The terminal draws that as
 * an `ask N questions` form; the Dashboard drew nothing, so a chat user saw an
 * answer that simply stopped — the same failure the approval card fixed, with
 * the same cause.
 *
 * ── The wire protocol, read off tui_gateway/server.py::_clarify_block ────
 *
 * One event, two shapes. A single question keeps the historical payload
 * (deliberately, so old renderers keep working):
 *
 *   clarify.request  {request_id, question, choices[], multi_select?}
 *
 * A batch carries the list instead:
 *
 *   clarify.request  {request_id, questions: [{qid, question, choices[],
 *                                              multi_select}]}
 *
 * Answering is `clarify.respond {request_id, question_id?, answer}`. For a
 * batch, each question is answered **separately by its `qid`**, and the server
 * replies `{status, remaining[]}`. Locking the last one is what unblocks the
 * tool — there is no separate submit call, and answers stay editable until then
 * ("update-in-place is deliberate", server.py:14118).
 *
 * `clarify.expire {request_id}` arrives when the wait times out (default 300s,
 * configurable, and `<= 0` means never).
 *
 * ── Answer formats, which are easy to get wrong ─────────────────────────
 *
 * Single-select: the choice label, **verbatim**. The tool runs
 * `strip_recommended` over whatever comes back, so the "(Recommended)" suffix
 * that ships inside the label string is safe to send as-is — and it is part of
 * the label, not a separate field.
 *
 * Multi-select: a JSON array string of labels. `_parse_multi_select_response`
 * accepts a JSON array, a comma-separated string, or a real list; the array is
 * the unambiguous one, since a label may itself contain a comma.
 *
 * Open-ended (no choices): free text.
 *
 * ── One honest gap ──────────────────────────────────────────────────────
 *
 * Unlike approvals there is **no `clarify.pending` RPC**. A card lost before
 * the page opened cannot be recovered by asking; only the event replay
 * (`session.events.since`) brings one back, and only while it is still in the
 * ring. The card says so rather than pretending the Terminal tab is optional.
 */

export interface ClarifyQuestion {
  /** `qid` for a batch; empty for the single-question shape. */
  qid: string;
  question: string;
  /** Choice labels exactly as Hermes sent them, "(Recommended)" included. */
  choices: string[];
  multiSelect: boolean;
}

export interface ClarifyRequest {
  requestId: string;
  questions: ClarifyQuestion[];
  /** True when the payload used the batch shape. */
  batch: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function choiceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
    .filter((entry) => entry.trim().length > 0);
}

/** Read a `clarify.request` payload in either shape. */
export function parseClarifyRequest(raw: unknown): ClarifyRequest | null {
  const record = asRecord(raw);
  if (!record) return null;
  const requestId = str(record.request_id).trim();
  if (!requestId) return null;

  const batch = Array.isArray(record.questions);
  if (batch) {
    const questions: ClarifyQuestion[] = [];
    for (const item of record.questions as unknown[]) {
      const entry = asRecord(item);
      if (!entry) continue;
      const question = str(entry.question).trim();
      const qid = str(entry.qid).trim();
      // A batch entry with no qid could never be answered — the server
      // rejects an unknown question_id — so it is dropped rather than drawn.
      if (!question || !qid) continue;
      questions.push({
        choices: choiceList(entry.choices),
        multiSelect: entry.multi_select === true,
        qid,
        question,
      });
    }
    return questions.length ? { batch: true, questions, requestId } : null;
  }

  const question = str(record.question).trim();
  if (!question) return null;
  return {
    batch: false,
    questions: [
      {
        choices: choiceList(record.choices),
        multiSelect: record.multi_select === true,
        qid: "",
        question,
      },
    ],
    requestId,
  };
}

/** The request id a `clarify.expire` event refers to. */
export function parseClarifyExpire(raw: unknown): string {
  return str(asRecord(raw)?.request_id).trim();
}

/**
 * What the person has picked so far, per question.
 *
 * `selected` holds choice labels; `custom` holds free text typed into the
 * "Other" box. A question is answered when either is non-empty.
 */
export interface ClarifyDraft {
  selected: string[];
  custom: string;
}

export const EMPTY_DRAFT: ClarifyDraft = { custom: "", selected: [] };

/** Toggle one choice, honouring single- versus multi-select. */
export function toggleChoice(
  draft: ClarifyDraft,
  choice: string,
  multiSelect: boolean,
): ClarifyDraft {
  if (!multiSelect) {
    // Picking again clears it, so a mis-click is undoable.
    return draft.selected[0] === choice
      ? { ...draft, selected: [] }
      : { ...draft, selected: [choice] };
  }
  const has = draft.selected.includes(choice);
  return {
    ...draft,
    selected: has
      ? draft.selected.filter((entry) => entry !== choice)
      : [...draft.selected, choice],
  };
}

export function isAnswered(draft: ClarifyDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim().length > 0;
}

/**
 * The `answer` string for one question.
 *
 * Typed text always wins over a selection: someone who used the "Other" box
 * meant that, and a stale radio underneath must not override it.
 */
export function buildAnswer(
  question: ClarifyQuestion,
  draft: ClarifyDraft,
): string {
  const custom = draft.custom.trim();
  if (custom) return custom;
  if (!draft.selected.length) return "";
  if (question.multiSelect) {
    // A JSON array, because a choice label may itself contain a comma and the
    // comma-separated fallback would then split it in the wrong place.
    return JSON.stringify(draft.selected);
  }
  return draft.selected[0];
}

/** Params for one `clarify.respond` call. */
export function buildClarifyResponse(
  request: ClarifyRequest,
  question: ClarifyQuestion,
  draft: ClarifyDraft,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    answer: buildAnswer(question, draft),
    request_id: request.requestId,
  };
  // Only a batch carries a question_id; sending one for a single question
  // would make the server look for a batch that does not exist.
  if (request.batch && question.qid) params.question_id = question.qid;
  return params;
}

/** How many of the questions have an answer ready. */
export function answeredCount(
  request: ClarifyRequest,
  drafts: Record<string, ClarifyDraft>,
): number {
  return request.questions.filter((question) =>
    isAnswered(drafts[question.qid || "single"] ?? EMPTY_DRAFT),
  ).length;
}

/** `"2/4 câu đã trả lời"`, or the single-question wording. */
export function progressVi(
  request: ClarifyRequest,
  drafts: Record<string, ClarifyDraft>,
): string {
  const total = request.questions.length;
  if (total === 1) {
    return isAnswered(drafts["single"] ?? drafts[""] ?? EMPTY_DRAFT)
      ? "Đã chọn — bấm gửi để Hermes chạy tiếp"
      : "Hermes đang chờ câu trả lời";
  }
  return `${answeredCount(request, drafts)}/${total} câu đã trả lời`;
}

/**
 * Hermes marks its own suggestion by putting "(Recommended)" in the label.
 * The tool strips it on the way back, so the UI shows it as a badge and still
 * sends the label untouched.
 */
export function splitRecommended(choice: string): {
  label: string;
  recommended: boolean;
} {
  const match = choice.match(/^(.*?)\s*\((?:recommended|khuyến nghị)\)\s*$/i);
  return match
    ? { label: match[1].trim(), recommended: true }
    : { label: choice, recommended: false };
}

/**
 * Is this the runtime's own "type your own answer" choice?
 *
 * Hermes appends it to a choice list when free text is allowed. Rendering it
 * as a normal button would give the person a dead option — it needs the text
 * box instead.
 */
export function isOtherChoice(choice: string): boolean {
  return /^other\b/i.test(choice.trim());
}

/** The choices worth drawing as buttons, and whether a text box is needed. */
export function usableChoices(question: ClarifyQuestion): {
  choices: string[];
  allowCustom: boolean;
} {
  const choices = question.choices.filter((choice) => !isOtherChoice(choice));
  return {
    allowCustom:
      choices.length !== question.choices.length || question.choices.length === 0,
    choices,
  };
}
