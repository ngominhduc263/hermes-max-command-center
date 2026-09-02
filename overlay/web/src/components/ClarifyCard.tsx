import { useMemo, useState } from "react";
import { Check, HelpCircle, LoaderCircle, Send, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildAnswer,
  EMPTY_DRAFT,
  isAnswered,
  progressVi,
  splitRecommended,
  toggleChoice,
  usableChoices,
  type ClarifyDraft,
  type ClarifyQuestion,
  type ClarifyRequest,
} from "@/lib/chat-clarify";

interface ClarifyCardProps {
  request: ClarifyRequest;
  /**
   * Send one answer. Resolves false when it did not land, in which case the
   * question stays open — a clarify blocks the whole turn, so quietly losing
   * an answer would leave Hermes waiting forever.
   */
  onAnswer: (question: ClarifyQuestion, draft: ClarifyDraft) => Promise<boolean>;
}

/**
 * The `clarify` question card.
 *
 * Hermes calls `clarify` when it needs a decision it should not make alone,
 * and the tool **blocks the turn** until it gets one. The terminal draws this
 * as `ask N questions`; the Dashboard drew nothing, so the chat just stopped
 * mid-answer with no way to unstick it.
 *
 * Two details that decide whether this works or wastes the user's time:
 *
 * - **A batch is answered one question at a time**, each by its own `qid`, and
 *   the last lock is what releases the tool. There is no submit call, so the
 *   card sends each answer as it is confirmed and says how many remain.
 * - **Answers stay editable until the batch completes** (the server updates in
 *   place on purpose), so a confirmed question can still be changed — the card
 *   allows that rather than freezing rows the runtime would still accept.
 */
export function ClarifyCard({ request, onAnswer }: ClarifyCardProps) {
  const [drafts, setDrafts] = useState<Record<string, ClarifyDraft>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState("");

  const keyOf = (question: ClarifyQuestion) => question.qid || "single";
  const draftOf = (question: ClarifyQuestion) =>
    drafts[keyOf(question)] ?? EMPTY_DRAFT;

  const progress = useMemo(() => progressVi(request, drafts), [drafts, request]);

  const update = (question: ClarifyQuestion, next: ClarifyDraft) => {
    setDrafts((current) => ({ ...current, [keyOf(question)]: next }));
  };

  const confirm = (question: ClarifyQuestion) => {
    const draft = draftOf(question);
    if (!isAnswered(draft)) return;
    const key = keyOf(question);
    setBusy(key);
    setFailed("");
    void onAnswer(question, draft)
      .then((ok) => {
        if (ok) setSent((current) => ({ ...current, [key]: true }));
        else setFailed("Không gửi được câu trả lời — thử lại, hoặc sang tab Terminal.");
      })
      .catch(() =>
        setFailed("Không gửi được câu trả lời — thử lại, hoặc sang tab Terminal."),
      )
      .finally(() => setBusy(""));
  };

  return (
    <section className="hermes-clarify" aria-label="Hermes đang hỏi lại">
      <header>
        <HelpCircle className="h-4 w-4" />
        <strong>
          {request.questions.length > 1
            ? `Hermes hỏi lại ${request.questions.length} câu`
            : "Hermes hỏi lại"}
        </strong>
        <span>{progress}</span>
      </header>

      <p className="hermes-clarify-note">
        Hermes đang dừng và chờ ở đây — trả lời xong nó chạy tiếp.
      </p>

      <ol className="hermes-clarify-questions">
        {request.questions.map((question) => {
          const draft = draftOf(question);
          const { allowCustom, choices } = usableChoices(question);
          const key = keyOf(question);
          const locked = sent[key];

          return (
            <li key={key} className={cn(locked && "is-answered")}>
              <p className="hermes-clarify-question">
                {question.question}
                {locked ? (
                  <em>
                    <Check className="h-3 w-3" /> đã gửi — vẫn sửa được
                  </em>
                ) : null}
                {question.multiSelect ? <i>chọn được nhiều</i> : null}
              </p>

              {choices.length ? (
                <div className="hermes-clarify-choices">
                  {choices.map((choice) => {
                    const { label, recommended } = splitRecommended(choice);
                    const picked = draft.selected.includes(choice);
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={cn(picked && "is-picked")}
                        onClick={() =>
                          update(
                            question,
                            toggleChoice(draft, choice, question.multiSelect),
                          )
                        }
                      >
                        {picked ? <Check className="h-3.5 w-3.5" /> : null}
                        <span>{label}</span>
                        {recommended ? (
                          <em>
                            <Sparkles className="h-3 w-3" /> Hermes gợi ý
                          </em>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {allowCustom ? (
                <input
                  className="hermes-clarify-custom"
                  value={draft.custom}
                  placeholder={
                    choices.length ? "…hoặc tự viết câu trả lời" : "Câu trả lời của anh"
                  }
                  onChange={(event) =>
                    update(question, { ...draft, custom: event.currentTarget.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirm(question);
                    }
                  }}
                />
              ) : null}

              <div className="hermes-clarify-actions">
                <button
                  type="button"
                  disabled={!isAnswered(draft) || busy === key}
                  onClick={() => confirm(question)}
                >
                  {busy === key ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {locked ? "Gửi lại" : "Chốt câu này"}
                </button>
                {isAnswered(draft) ? (
                  <code>{buildAnswer(question, draft)}</code>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {failed ? <p className="hermes-clarify-failed">{failed}</p> : null}
    </section>
  );
}
