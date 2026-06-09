import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/storage";
import { getJournalEntry, setJournalEntry } from "@/lib/storage";
import {
  PERIODS,
  keyToDate,
  periodKey,
  periodLabel,
  periodPrompt,
  shiftPeriod,
} from "@/lib/periods";
import type { JournalEntry, JournalPeriod } from "@/lib/types";

export default function Journal() {
  const { journal } = useStore();
  const [period, setPeriod] = useState<JournalPeriod>("day");
  const [anchor, setAnchor] = useState(() => new Date());

  const key = periodKey(period, anchor);
  const saved = getJournalEntry(period, key);
  const [text, setText] = useState(saved?.text ?? "");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setText(getJournalEntry(period, key)?.text ?? "");
    setJustSaved(false);
  }, [period, key]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function commit(value: string) {
    setJournalEntry(period, key, value);
    setJustSaved(true);
  }

  function onChange(value: string) {
    setText(value);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => commit(value), 600);
  }

  function onBlur() {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    commit(text);
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Journal</div>
        <h1 className="font-serif text-3xl text-foreground">What you actually did</h1>
        <p className="text-muted-foreground mt-1">
          In your own words — whatever you accomplished, whether or not you planned it. The app reads
          this into its picture of you.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-card-border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            onClick={() => setAnchor(shiftPeriod(period, anchor, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="font-serif text-xl text-foreground">{periodLabel(period, anchor)}</div>
            <button
              className="text-[11px] uppercase tracking-widest text-primary hover:underline mt-0.5"
              onClick={() => setAnchor(new Date())}
            >
              Jump to now
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            onClick={() => setAnchor(shiftPeriod(period, anchor, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <label className="block text-sm text-muted-foreground mb-2">{periodPrompt(period)}</label>
        <Textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Write freely. What got done, what didn't, what surprised you, what you're proud of or avoided."
          rows={10}
          className="min-h-[220px] text-base leading-relaxed resize-y"
        />
        <div className="text-[11px] text-muted-foreground mt-2 h-4">
          {justSaved ? "Saved." : "Saves automatically."}
        </div>
      </section>

      <RecentEntries entries={journal} onOpen={(p, a) => { setPeriod(p); setAnchor(a); }} />
    </div>
  );
}

function RecentEntries({
  entries,
  onOpen,
}: {
  entries: JournalEntry[];
  onOpen: (period: JournalPeriod, anchor: Date) => void;
}) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );
  if (sorted.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Past entries</h2>
      <div className="space-y-3">
        {sorted.map((e) => {
          const d = keyToDate(e.period, e.periodKey);
          return (
            <button
              key={`${e.period}:${e.periodKey}`}
              onClick={() => onOpen(e.period, d)}
              className="block w-full text-left rounded-xl border border-card-border bg-card p-4 hover-elevate"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-foreground">{periodLabel(e.period, d)}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                  {e.period}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-3 leading-relaxed">
                {e.text}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
