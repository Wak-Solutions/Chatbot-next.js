"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useParams } from "@/lib/router";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { csrfFetch } from "@/lib/queryClient";

interface Question {
  id: number;
  question_text: string;
  question_type: "rating" | "yes_no" | "free_text";
  order_index: number;
}

interface SurveyData {
  survey_id: number;
  title: string;
  description: string;
  questions: Question[];
}

interface Answer {
  question_id: number;
  answer_rating?: number | null;
  answer_yes_no?: boolean | null;
  answer_text?: string | null;
}

export default function SurveyPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid" | "submitted">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    fetch(`/api/survey/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body.message || "This survey link is no longer valid.");
          setStatus("invalid");
          return;
        }
        const data = await res.json();
        setSurvey(data);
        setStatus("ready");
      })
      .catch(() => {
        setErrorMsg("Unable to load survey. Please try again later.");
        setStatus("invalid");
      });
  }, [token]);

  const setRating = (qid: number, rating: number) =>
    setAnswers((p) => ({ ...p, [qid]: { question_id: qid, answer_rating: rating } }));

  const setYesNo = (qid: number, value: boolean) =>
    setAnswers((p) => ({ ...p, [qid]: { question_id: qid, answer_yes_no: value } }));

  const setText = (qid: number, text: string) =>
    setAnswers((p) => ({ ...p, [qid]: { question_id: qid, answer_text: text } }));

  const handleSubmit = async () => {
    if (!survey) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      const payload: Answer[] = survey.questions.map((q) => {
        const a = answers[q.id];
        return {
          question_id: q.id,
          answer_rating: q.question_type === "rating" ? (a?.answer_rating ?? null) : null,
          answer_yes_no: q.question_type === "yes_no" ? (a?.answer_yes_no ?? null) : null,
          answer_text: q.question_type === "free_text" ? (a?.answer_text ?? null) : null,
        };
      });
      const res = await csrfFetch(`/api/survey/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.message || "Failed to submit. Please try again.");
        return;
      }
      setStatus("submitted");
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F2EC] flex flex-col">
      {/* Header */}
      <header className="bg-brand-blue px-5 py-4 flex items-center gap-3 shadow-md">
        <div className="w-8 h-8 rounded-full bg-brand-navy/20 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">W</span>
        </div>
        <span className="text-white font-semibold text-sm">WAK Solutions</span>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-8">
        {/* Loading */}
        {status === "loading" && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
          </div>
        )}

        {/* Invalid / expired */}
        {status === "invalid" && (
          <div className="bg-brand-navy rounded-2xl p-8 text-center shadow-sm border border-white/[0.06]">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-lg font-semibold text-white mb-1 leading-snug" dir="rtl">
              هذا الرابط لم يعد صالحاً.
            </p>
            <p className="text-lg font-semibold text-white mb-4">
              This survey link is no longer valid.
            </p>
            {errorMsg && <p className="text-sm text-brand-slate/70">{errorMsg}</p>}
          </div>
        )}

        {/* Thank-you */}
        {status === "submitted" && (
          <div className="bg-brand-navy rounded-2xl p-8 text-center shadow-sm border border-white/[0.06]">
            <CheckCircle2 className="w-14 h-14 text-brand-blue mx-auto mb-5" />
            <p className="text-xl font-bold text-white mb-1 leading-snug" dir="rtl">
              شكراً على وقتك ومشاركتك! 💚
            </p>
            <p className="text-xl font-bold text-white">Thank you for your feedback!</p>
          </div>
        )}

        {/* Survey */}
        {status === "ready" && survey && (
          <div className="space-y-5">
            {/* Header card */}
            <div className="bg-brand-navy rounded-2xl p-6 shadow-sm border border-white/[0.06]">
              <h1 className="text-xl font-bold text-brand-blue mb-1">{survey.title}</h1>
              {survey.description && (
                <p className="text-sm text-brand-slate">{survey.description}</p>
              )}
            </div>

            {/* Questions */}
            {survey.questions.map((q, idx) => (
              <div key={q.id} className="bg-brand-navy rounded-2xl p-6 shadow-sm border border-white/[0.06] space-y-4">
                <p className="text-sm font-semibold text-white leading-snug">
                  <span className="text-brand-blue mr-1.5">{idx + 1}.</span>
                  {q.question_text}
                </p>

                {/* Rating: 1–5 tap buttons */}
                {q.question_type === "rating" && (
                  <div className="flex gap-3 justify-center">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const selected = answers[q.id]?.answer_rating === n;
                      return (
                        <button
                          key={n}
                          onClick={() => setRating(q.id, n)}
                          className={`w-13 h-13 min-w-[52px] min-h-[52px] rounded-xl text-lg font-bold border-2 transition-all select-none ${
                            selected
                              ? "bg-brand-blue border-brand-blue text-white scale-105 shadow-md"
                              : "bg-brand-navy border-white/[0.08] text-brand-slate hover:border-brand-blue active:scale-95"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Yes / No */}
                {q.question_type === "yes_no" && (
                  <div className="grid grid-cols-2 gap-3">
                    {([true, false] as const).map((val) => {
                      const selected = answers[q.id]?.answer_yes_no === val;
                      return (
                        <button
                          key={String(val)}
                          onClick={() => setYesNo(q.id, val)}
                          className={`py-4 rounded-xl text-base font-bold border-2 transition-all select-none ${
                            selected
                              ? val
                                ? "bg-brand-blue border-brand-blue text-white shadow-md"
                                : "bg-red-500 border-red-500 text-white shadow-md"
                              : "bg-brand-navy border-white/[0.08] text-white/90 hover:border-white/[0.10] active:scale-95"
                          }`}
                        >
                          {val ? "Yes / نعم" : "No / لا"}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Free text */}
                {q.question_type === "free_text" && (
                  <textarea
                    rows={3}
                    value={answers[q.id]?.answer_text ?? ""}
                    onChange={(e) => setText(q.id, e.target.value)}
                    placeholder="Your answer… / إجابتك…"
                    className="w-full border-2 border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/90 focus:outline-none focus:border-brand-blue resize-none"
                  />
                )}
              </div>
            ))}

            {/* Error */}
            {submitError && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3 border border-red-100">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {submitError}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-brand-blue text-white py-4 rounded-2xl text-base font-semibold hover:bg-brand-cyan disabled:opacity-60 transition-colors active:scale-[0.99]"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting…
                </span>
              ) : (
                "Submit — إرسال"
              )}
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-brand-slate/70 border-t border-white/[0.06] mt-2">
        © 2026 WAK Solutions ·{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-brand-slate transition-colors underline underline-offset-2">
          Terms &amp; Conditions
        </a>
      </footer>
    </div>
  );
}
