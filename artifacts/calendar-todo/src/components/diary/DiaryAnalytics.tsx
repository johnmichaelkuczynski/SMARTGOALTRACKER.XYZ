import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAnalyzeDiary } from "@workspace/api-client-react";
import type { DiaryAnalyticsReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ensureStateSaved } from "@/lib/storage";
import { useAuth } from "@/lib/useAuth";
import type { DiaryEntry } from "@/lib/types";
import { countWords, entryWriting, errorMessage, isValidDateKey, shortDateLabel, todayKey } from "./diaryHelpers";

const FOCUS_PROMPTS = [
  "What keeps coming up in my writing?",
  "How has my mood shifted over this period?",
  "What do I write about my goals versus what I do?",
];

type AnalysisSession = {
  from: string;
  to: string;
  question: string;
  report: DiaryAnalyticsReport | null;
  reportSources: string;
};

function readAnalysisSession(key: string | null): AnalysisSession | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as AnalysisSession;
    if (!isValidDateKey(value.from) || !isValidDateKey(value.to) || typeof value.question !== "string") return null;
    if (value.report && (
      typeof value.report.summary !== "string" ||
      !Array.isArray(value.report.themes) ||
      !Array.isArray(value.report.changes) ||
      !Array.isArray(value.report.suggestions) ||
      !value.report.stats
    )) return null;
    return value;
  } catch {
    return null;
  }
}

export function DiaryAnalytics({
  entries,
  onOpenDate,
}: {
  entries: DiaryEntry[];
  onOpenDate: (date: string) => void;
}) {
  const { data: auth } = useAuth();
  const sessionKey = auth?.authenticated && auth.user
    ? `tally:diary-analysis:${auth.user.id}`
    : null;
  const cached = useRef(readAnalysisSession(sessionKey)).current;
  const [from, setFrom] = useState(() => cached?.from ?? format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => cached?.to ?? todayKey());
  const [question, setQuestion] = useState(() => cached?.question ?? "");
  const [report, setReport] = useState<DiaryAnalyticsReport | null>(() => cached?.report ?? null);
  const [reportSources, setReportSources] = useState(() => cached?.reportSources ?? "");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const analyze = useAnalyzeDiary();

  const rangeValid = isValidDateKey(from) && isValidDateKey(to) && from <= to;
  const sources = entries.filter((entry) => entry.date >= from && entry.date <= to)
    .map((entry) => `${entry.id ?? entry.date}:${entry.updatedAt}`).sort().join("|");
  useEffect(() => {
    if (!sessionKey) return;
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({ from, to, question, report, reportSources }));
    } catch {
      // This is only an analysis-view cache, never the diary's writing store.
    }
  }, [sessionKey, from, to, question, report, reportSources]);

  const local = useMemo(() => {
    const inRange = entries.filter(
      (e) => e.date >= from && e.date <= to,
    );
    const writing = inRange.filter((entry) => entryWriting(entry));
    return {
      entryCount: writing.length,
      writingDays: new Set(writing.map((e) => e.date)).size,
      wordCount: writing.reduce((sum, e) => sum + countWords(entryWriting(e)), 0),
      questions: inRange.reduce(
        (sum, e) => sum + (e.conversation ?? []).filter((m) => m.kind === "question").length,
        0,
      ),
    };
  }, [entries, from, to]);

  async function run() {
    if (running || !rangeValid) return;
    setRunning(true);
    setError("");
    try {
      await ensureStateSaved();
      const result = await analyze.mutateAsync({
        data: { from, to, question: question.trim() || undefined },
      });
      setReport(result);
      setReportSources(sources);
    } catch (caught) {
      setError(errorMessage(caught, "The analysis could not be generated."));
    } finally {
      setRunning(false);
    }
  }

  const stats = [
    { label: "Entries", value: local.entryCount, id: "entries" },
    { label: "Writing days", value: local.writingDays, id: "days" },
    { label: "Words", value: local.wordCount.toLocaleString(), id: "words" },
    { label: "Questions asked", value: local.questions, id: "questions" },
  ];

  return (
    <section className="space-y-6" data-testid="section-diary-analytics">
      <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs uppercase tracking-widest text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setReport(null); }}
              disabled={running}
              data-testid="input-analytics-from"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
            />
          </label>
          <label className="block text-xs uppercase tracking-widest text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => { setTo(e.target.value); setReport(null); }}
              disabled={running}
              data-testid="input-analytics-to"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
            />
          </label>
        </div>
        {!rangeValid && (
          <p className="mt-2 text-xs text-destructive" data-testid="text-analytics-range-error">
            Choose a start date on or before the end date.
          </p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stats-diary-local">
          {stats.map((s) => (
            <div key={s.id} className="rounded-lg border border-card-border bg-background px-3 py-3">
              <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.label}</dt>
              <dd className="mt-1 font-serif text-2xl text-foreground" data-testid={`stat-${s.id}`}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Counted from your saved entries between {shortDateLabel(from)} and {shortDateLabel(to)}.
        </p>

        <label htmlFor="analytics-question" className="mt-5 block text-sm text-muted-foreground">
          Focus (optional)
        </label>
        <Textarea
          id="analytics-question"
          value={question}
          onChange={(e) => { setQuestion(e.target.value); setReport(null); }}
          disabled={running}
          placeholder="What would you like the analysis to look at?"
          rows={3}
          maxLength={2000}
          data-testid="input-analytics-question"
          className="mt-1 resize-y text-base leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {FOCUS_PROMPTS.map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => { setQuestion(p); setReport(null); }}
              disabled={running}
              data-testid={`button-analytics-prompt-${i}`}
              className="rounded-full border border-card-border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            onClick={run}
            disabled={running || !rangeValid || local.entryCount === 0}
            className="gap-2"
            data-testid="button-generate-analysis"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {running ? "Analyzing..." : report ? "Refresh analysis" : "Generate analysis"}
          </Button>
        </div>
      </div>

      {local.entryCount === 0 && !report && (
        <div className="rounded-xl border border-dashed border-card-border px-6 py-10 text-center" data-testid="status-analytics-empty">
          <p className="font-serif text-lg text-foreground">Nothing written in this range yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Widen the dates or write an entry first.</p>
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="status-analytics-error">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
          <Button type="button" size="sm" variant="outline" onClick={run} disabled={running} data-testid="button-retry-analysis">
            Retry
          </Button>
        </div>
      )}

      {running && !report && (
        <div className="space-y-3" data-testid="status-analytics-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {report && (
        <article className={`space-y-5 rounded-xl border border-card-border bg-card p-4 sm:p-6 ${running ? "opacity-60" : ""}`} data-testid="card-analytics-report">
          {sources !== reportSources && (
            <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-muted-foreground" data-testid="status-analysis-outdated">
              Your entries have changed since this analysis. Refresh it to include your latest writing.
            </p>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <span data-testid="text-report-range">
              {shortDateLabel(report.stats.from)} to {shortDateLabel(report.stats.to)} · {report.stats.entryCount} entries · {report.stats.writingDays} days · {report.stats.wordCount.toLocaleString()} words
            </span>
            <span>Generated {format(parseISO(report.generatedAt), "MMM d, h:mm a")}</span>
          </div>
          <p className="whitespace-pre-wrap font-serif text-lg leading-relaxed text-foreground" data-testid="text-report-summary">
            {report.summary}
          </p>

          {report.themes.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Themes</h3>
              <ul className="space-y-3">
                {report.themes.map((t, i) => (
                  <li key={i} className="rounded-lg border-l-2 border-primary/50 bg-background px-4 py-3" data-testid={`card-theme-${i}`}>
                    <div className="font-medium text-foreground">{t.title}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{t.observation}</p>
                    {t.dates.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Evidence</span>
                        {t.dates.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => onOpenDate(d)}
                            data-testid={`button-evidence-${i}-${d}`}
                            className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20"
                          >
                            {shortDateLabel(d)}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ReportList title="What changed" items={report.changes} id="changes" />
          <ReportList title="Suggestions" items={report.suggestions} id="suggestions" />
        </article>
      )}
    </section>
  );
}

function ReportList({ title, items, id }: { title: string; items: string[]; id: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground" data-testid={`text-${id}-${i}`}>
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
            <span className="whitespace-pre-wrap">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
