import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Send, RefreshCw, Loader2 } from "lucide-react";
import {
  useAnalyzePsychology,
  useChatPsychology,
  type PsychAnalysis,
  type PsychChatMessage,
  type GoalSnapshot,
} from "@workspace/api-client-react";
import { useStore } from "@/lib/storage";
import { goalSnapshots } from "@/lib/analytics";
import { periodLabel, keyToDate } from "@/lib/periods";
import { Button } from "@/components/ui/button";

const ANALYSIS_KEY = "tally:psych:v1";
const CHAT_KEY = "tally:psych-chat:v1";

function loadAnalysis(): PsychAnalysis | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    return raw ? (JSON.parse(raw) as PsychAnalysis) : null;
  } catch {
    return null;
  }
}

function loadChat(): PsychChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as PsychChatMessage[]) : [];
  } catch {
    return [];
  }
}

export default function Mind() {
  const { tasks, completions, journal } = useStore();
  const goals = useMemo<GoalSnapshot[]>(
    () => goalSnapshots(tasks, completions),
    [tasks, completions],
  );

  const reflections = useMemo(
    () =>
      [...journal]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 30)
        .map((e) => ({
          period: e.period,
          label: periodLabel(e.period, keyToDate(e.period, e.periodKey)),
          text: e.text,
        })),
    [journal],
  );

  const [analysis, setAnalysis] = useState<PsychAnalysis | null>(() => loadAnalysis());
  const [chat, setChat] = useState<PsychChatMessage[]>(() => loadChat());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyzePsychology();
  const sendChat = useChatPsychology();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (analysis) localStorage.setItem(ANALYSIS_KEY, JSON.stringify(analysis));
  }, [analysis]);
  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  }, [chat]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, sendChat.isPending]);

  const hasGoals = goals.length > 0;
  const hasReflections = reflections.length > 0;
  const canAnalyze = hasGoals || hasReflections;

  async function runAnalysis() {
    setError(null);
    try {
      const result = await analyze.mutateAsync({ data: { goals, reflections } });
      setAnalysis(result);
    } catch {
      setError("Could not build your profile right now. Try again in a moment.");
    }
  }

  async function submitChat(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sendChat.isPending) return;
    setError(null);
    const next = [...chat, { role: "user", content: text }];
    setChat(next);
    setInput("");
    try {
      const result = await sendChat.mutateAsync({
        data: {
          messages: next,
          goals,
          categories: analysis?.categories,
          profileSummary: analysis?.summary ?? null,
          reflections,
        },
      });
      setChat([...next, { role: "assistant", content: result.reply }]);
    } catch {
      setChat(next);
      setError("Couldn't get a reply. Try again.");
    }
  }

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Mind</div>
          <h1 className="font-serif text-3xl text-foreground">What your goals say about you</h1>
          <p className="text-muted-foreground mt-1">
            A read on the kind of person your goals describe — and where you actually follow through.
          </p>
        </div>
        <Button
          variant={analysis ? "outline" : "default"}
          size="sm"
          onClick={runAnalysis}
          disabled={!canAnalyze || analyze.isPending}
          className="shrink-0"
        >
          {analyze.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Reading…
            </>
          ) : analysis ? (
            <>
              <RefreshCw className="size-4" /> Rebuild profile
            </>
          ) : (
            <>
              <Brain className="size-4" /> Build my profile
            </>
          )}
        </Button>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!canAnalyze && (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Add a few goals or write a journal entry first. Once you have either, come back and I'll
            tell you what they say about you.
          </p>
        </div>
      )}

      {canAnalyze && !analysis && !analyze.isPending && (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <Brain className="size-7 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-3 max-w-md mx-auto">
            I'll look at the nature of your goals, how reliably you hit them, and what you've written
            you actually did, then describe the person behind it all. Nothing is saved to a server.
          </p>
        </div>
      )}

      {analyze.isPending && !analysis && (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <Loader2 className="size-7 mx-auto text-muted-foreground animate-spin" />
          <p className="text-muted-foreground mt-3">Reading your goals…</p>
        </div>
      )}

      {analysis && (
        <>
          <section className="rounded-xl border border-card-border bg-card p-6">
            <h2 className="font-serif text-2xl text-foreground leading-snug">{analysis.headline}</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">{analysis.summary}</p>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-4">
              Profiled {new Date(analysis.generatedAt).toLocaleDateString()}
            </div>
          </section>

          {analysis.traits.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Traits</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.traits.map((t, i) => (
                  <div key={i} className="rounded-xl border border-card-border bg-card p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium text-foreground">{t.label}</div>
                      <div className="font-mono text-sm tabular-nums text-muted-foreground">
                        {Math.round(t.score)}
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(0, Math.min(100, t.score))}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{t.note}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {analysis.categories.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Where you follow through
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                Completion rate by the kind of goal. The numbers are yours — what you said versus what you did.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.categories.map((c, i) => {
                  const pct = Math.round(c.rate * 100);
                  return (
                    <div key={i} className="rounded-xl border border-card-border bg-card p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-medium text-foreground">{c.name}</div>
                        <div className="font-mono text-2xl tabular-nums text-foreground">
                          {c.due ? `${pct}%` : "—"}
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {c.due
                          ? `${c.done} of ${c.due} completed · ${c.taskCount} goal${c.taskCount === 1 ? "" : "s"}`
                          : `${c.taskCount} goal${c.taskCount === 1 ? "" : "s"}, nothing due yet`}
                      </div>
                      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{c.blurb}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {analysis.insights.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Patterns</h2>
              <div className="rounded-xl border border-card-border bg-card divide-y divide-card-border">
                {analysis.insights.map((ins, i) => (
                  <div key={i} className="flex gap-3 p-4">
                    <div className="font-mono text-xs tabular-nums text-muted-foreground pt-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{ins}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Talk it through</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Ask about your patterns or float a hypothetical — like "what if I set jogging six miles
          today?" It answers from your actual goals.
        </p>
        <div className="rounded-xl border border-card-border bg-card flex flex-col">
          <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-5 space-y-4">
            {chat.length === 0 && !sendChat.isPending && (
              <p className="text-sm text-muted-foreground italic">
                {analysis
                  ? "Nothing here yet. Ask me something."
                  : "Build your profile above first for sharper answers — or just ask away."}
              </p>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sendChat.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>
          <form onSubmit={submitChat} className="border-t border-card-border p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your patterns…"
              className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" size="sm" disabled={!input.trim() || sendChat.isPending}>
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
