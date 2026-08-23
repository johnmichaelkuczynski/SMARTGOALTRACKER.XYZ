import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isValid, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getDiaryEntry, setDiaryEntry, useStore } from "@/lib/storage";
import type { DiaryEntry } from "@/lib/types";

const todayKey = () => format(new Date(), "yyyy-MM-dd");

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

function diaryDateLabel(value: string): string {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "EEEE, MMMM d, yyyy") : value;
}

export default function Diary() {
  const { diary = [] } = useStore();
  const [date, setDate] = useState(todayKey);
  const [text, setText] = useState(() => getDiaryEntry(todayKey())?.text ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(getDiaryEntry(date)?.text ?? "");
    setJustSaved(false);
  }, [date]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  function commit(value: string) {
    setDiaryEntry(date, value);
    setJustSaved(true);
  }

  function updateText(value: string) {
    setText(value);
    setJustSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => commit(value), 600);
  }

  function finishEditing() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    commit(text);
  }

  function moveDate(days: number) {
    setDate(format(addDays(parseISO(date), days), "yyyy-MM-dd"));
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Diary</div>
        <h1 className="font-serif text-3xl text-foreground">Your day, in your own words</h1>
        <p className="mt-1 text-muted-foreground">
          Choose any date and write a private diary entry for that day.
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            onClick={() => moveDate(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex flex-col items-center gap-2">
            <label htmlFor="diary-date" className="text-xs uppercase tracking-widest text-muted-foreground">
              Entry date
            </label>
            <input
              id="diary-date"
              type="date"
              value={date}
              onChange={(event) => {
                if (isValidDateKey(event.target.value)) setDate(event.target.value);
              }}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              className="text-[11px] uppercase tracking-widest text-primary hover:underline"
              onClick={() => setDate(todayKey())}
            >
              Today
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next day"
            onClick={() => moveDate(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <label htmlFor="diary-entry" className="mb-2 block text-sm text-muted-foreground">
          Diary entry for {diaryDateLabel(date)}
        </label>
        <Textarea
          id="diary-entry"
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onBlur={finishEditing}
          placeholder="Write about what happened, what you noticed, how you felt, or anything you want to remember."
          rows={12}
          className="min-h-[280px] resize-y text-base leading-relaxed"
        />
        <div className="mt-2 h-4 text-[11px] text-muted-foreground">
          {justSaved ? "Saved." : "Saves automatically."}
        </div>
      </section>

      <PastDiaryEntries entries={diary} onOpen={setDate} />
    </div>
  );
}

function PastDiaryEntries({
  entries,
  onOpen,
}: {
  entries: DiaryEntry[];
  onOpen: (date: string) => void;
}) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    [entries],
  );

  if (sorted.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
        Past diary entries
      </h2>
      <div className="space-y-3">
        {sorted.map((entry) => (
          <button
            key={entry.date}
            type="button"
            onClick={() => onOpen(entry.date)}
            className="block w-full rounded-xl border border-card-border bg-card p-4 text-left hover-elevate"
          >
            <div className="font-medium text-foreground">
              {diaryDateLabel(entry.date)}
            </div>
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {entry.text}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}