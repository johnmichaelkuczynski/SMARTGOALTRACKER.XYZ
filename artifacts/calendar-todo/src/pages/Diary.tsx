import { useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { BarChart3, ChevronLeft, ChevronRight, HelpCircle, Loader2, NotebookPen, Plus, Sparkles, Trash2 } from "lucide-react";
import { useChatWithDiary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  addDiaryMessage,
  createDiaryEntry,
  deleteDiaryEntry,
  ensureStateSaved,
  getDiaryEntry,
  setDiaryDraft,
  setDiaryEntry,
  submitDiaryMessage,
  useSaveState,
  useStore,
} from "@/lib/storage";
import type { DiaryEntry } from "@/lib/types";
import { DiaryConversation } from "@/components/diary/DiaryConversation";
import { DiaryAnalytics } from "@/components/diary/DiaryAnalytics";
import { diaryDateLabel, entryKeyOf, errorMessage, isValidDateKey, todayKey } from "@/components/diary/diaryHelpers";

const QUESTION_STARTERS = [
  "What patterns show up across my recent entries?",
  "How have I been feeling about my goals lately?",
  "What have I been avoiding writing about?",
];

type View = "write" | "analytics";
const slot = (date: string, id: string) => `${date}|${id}`;

export default function Diary() {
  const { diary = [] } = useStore();
  const saveState = useSaveState();
  const initialSelection = useRef(new URLSearchParams(window.location.search)).current;
  const [view, setView] = useState<View>(() => initialSelection.get("view") === "analytics" ? "analytics" : "write");
  const [date, setDate] = useState(() => {
    const selected = initialSelection.get("date") ?? "";
    return isValidDateKey(selected) ? selected : todayKey();
  });
  const [chosenId, setChosenId] = useState<string | null>(() => initialSelection.get("entry"));
  const [interactive, setInteractive] = useState(() => initialSelection.get("mode") !== "standard");
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const chat = useChatWithDiary();
  const chatRef = useRef(chat.mutateAsync);
  chatRef.current = chat.mutateAsync;

  const sameDay = useMemo(
    () => diary.filter((e) => e.date === date).sort((a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt)),
    [diary, date],
  );
  const current = sameDay.find((e) => entryKeyOf(e) === chosenId) ?? (chosenId ? undefined : sameDay[0]);
  const currentId = current ? entryKeyOf(current) : chosenId;
  const key = currentId ? slot(date, currentId) : "";
  const thinking = !!pending[key];

  function rememberSelection(d: string, id: string | null, enabled = interactive, tab = view) {
    const url = new URL(window.location.href);
    url.searchParams.set("date", d);
    if (id) url.searchParams.set("entry", id);
    else url.searchParams.delete("entry");
    if (enabled) url.searchParams.delete("mode");
    else url.searchParams.set("mode", "standard");
    if (tab === "analytics") url.searchParams.set("view", "analytics");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  }

  function ensureEntry(): string {
    if (current) return entryKeyOf(current);
    const created = createDiaryEntry(date);
    const id = created.id!;
    setChosenId(id);
    rememberSelection(date, id);
    return id;
  }

  function goToDate(next: string, tab = view) {
    setDate(next);
    setChosenId(null);
    setView(tab);
    rememberSelection(next, null, interactive, tab);
  }

  function openEntry(entry: DiaryEntry) {
    setDate(entry.date);
    setChosenId(entryKeyOf(entry));
    setView("write");
    rememberSelection(entry.date, entryKeyOf(entry), interactive, "write");
  }

  function newEntry() {
    const created = createDiaryEntry(date);
    setChosenId(created.id!);
    rememberSelection(date, created.id!);
  }

  function updateDraft(value: string) {
    const id = ensureEntry();
    setDiaryDraft(date, value, id);
  }

  function updateProse(value: string) {
    const id = ensureEntry();
    setDiaryEntry(date, value, id);
  }

  async function requestReply(d: string, id: string) {
    const k = slot(d, id);
    if (inFlight.current.has(k)) return;
    inFlight.current.add(k);
    setPending((p) => ({ ...p, [k]: true }));
    setErrors((e) => ({ ...e, [k]: "" }));
    try {
      await ensureStateSaved();
      const entry = getDiaryEntry(d, id);
      if (!entry) throw new Error("This entry no longer exists.");
      const messages = (entry.conversation ?? [])
        .filter((m) => m.content.trim())
        .slice(-40)
        .map(({ role, content }) => ({ role, content }));
      const { reply } = await chatRef.current({
        data: { date: d, entryId: id, entry: entry.text, messages },
      });
      if (!reply?.trim()) throw new Error("No reply was received.");
      addDiaryMessage(d, { role: "assistant", content: reply }, id);
    } catch (caught) {
      setErrors((e) => ({ ...e, [k]: errorMessage(caught, "The Living Diary could not answer.") }));
    } finally {
      inFlight.current.delete(k);
      setPending((p) => ({ ...p, [k]: false }));
    }
  }

  function send(kind: "entry" | "question") {
    const content = kind === "entry" ? current?.draft ?? "" : question;
    if (!content.trim()) return;
    const d = date;
    const id = ensureEntry();
    if (inFlight.current.has(slot(d, id))) return;
    submitDiaryMessage(d, id, content, kind);
    if (kind === "question") setQuestion("");
    void requestReply(d, id);
  }

  function retry() {
    if (current) void requestReply(date, entryKeyOf(current));
  }

  function remove(entry: DiaryEntry) {
    const id = entryKeyOf(entry);
    deleteDiaryEntry(entry.date, id);
    if (entry.date === date && id === currentId) {
      setChosenId(null);
      rememberSelection(date, null);
    }
  }

  const draft = current?.draft ?? "";
  const hasConversation = (current?.conversation?.length ?? 0) > 0;
  const lastIsUnanswered = current?.conversation?.at(-1)?.role === "user";

  return (
    <div className="min-w-0 space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Diary</div>
          <h1 className="font-serif text-3xl text-foreground">Your day, in your own words</h1>
          <p className="mt-1 text-muted-foreground">Write privately, ask about what you have written, or look across a stretch of time.</p>
        </div>
        <div className="inline-flex rounded-lg border border-card-border bg-card p-1" role="tablist">
          {([["write", "Write", NotebookPen], ["analytics", "Diary Analytics", BarChart3]] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => { setView(v); rememberSelection(date, currentId, interactive, v); }}
              data-testid={`tab-diary-${v}`}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </header>

      <div hidden={view !== "analytics"}>
        <DiaryAnalytics entries={diary} onOpenDate={(d) => goToDate(d, "write")} />
      </div>
      {view === "write" && (
        <>
          <section className="rounded-xl border border-card-border bg-card p-3 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="icon" aria-label="Previous day" data-testid="button-prev-day" onClick={() => goToDate(format(addDays(parseISO(date), -1), "yyyy-MM-dd"))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center gap-2">
                <label htmlFor="diary-date" className="text-xs uppercase tracking-widest text-muted-foreground">Entry date</label>
                <input
                  id="diary-date"
                  type="date"
                  value={date}
                  data-testid="input-diary-date"
                  onChange={(e) => { if (isValidDateKey(e.target.value)) goToDate(e.target.value); }}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                />
                <button type="button" className="text-[11px] uppercase tracking-widest text-primary hover:underline" data-testid="button-today" onClick={() => goToDate(todayKey())}>
                  Today
                </button>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Next day" data-testid="button-next-day" onClick={() => goToDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground" data-testid="text-entry-count">
                {sameDay.length} {sameDay.length === 1 ? "entry" : "entries"} for this day
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Switch checked={interactive}
                    onCheckedChange={(enabled) => { setInteractive(enabled); rememberSelection(date, currentId, enabled); }}
                    aria-label="Make Diary interactive" data-testid="switch-interactive" />
                  Interactive
                </label>
                <Button type="button" variant="outline" size="sm" onClick={newEntry} className="gap-2" data-testid="button-new-entry">
                  <Plus className="h-4 w-4" /> New entry
                </Button>
              </div>
            </div>

            {sameDay.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {sameDay.map((entry, i) => {
                  const id = entryKeyOf(entry);
                  return (
                    <Button key={id} type="button" size="sm" variant={id === currentId ? "default" : "outline"} onClick={() => openEntry(entry)} data-testid={`button-entry-${id}`}>
                      Entry {sameDay.length - i}
                    </Button>
                  );
                })}
              </div>
            )}

            {interactive ? (
              <div className="rounded-xl border border-primary/25 bg-background" data-testid="panel-living-diary">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                  <label htmlFor="diary-entry" className="text-sm text-muted-foreground">Diary entry for {diaryDateLabel(date)}</label>
                  <span className="text-[11px] text-primary">Living Diary</span>
                </div>
                <DiaryConversation entry={current} thinking={thinking} error={errors[key] ?? ""} onRetry={retry} />
                <div className={`p-3 ${hasConversation || current?.text ? "border-t border-border" : ""}`}>
                  <Textarea
                    id="diary-entry"
                    value={draft}
                    onChange={(e) => updateDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send("entry"); }
                    }}
                    placeholder="Write what happened, what you noticed, how you felt..."
                    data-testid="input-diary-draft"
                    className="min-h-[240px] max-h-[70vh] resize-y border-0 bg-transparent text-base leading-relaxed shadow-none [field-sizing:content] focus-visible:ring-0"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground" data-testid="status-draft">
                      {draft
                        ? saveState === "saved"
                          ? "Draft saved · Enter starts a new paragraph"
                          : saveState === "error"
                            ? "Draft kept on this device · Server save needs retry"
                            : "Draft kept on this device · Syncing…"
                        : "Enter starts a new paragraph · Ctrl/Cmd+Enter to add"}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setAskOpen((o) => !o)} data-testid="button-toggle-ask">
                        <HelpCircle className="h-4 w-4" /> Ask about entries
                      </Button>
                      <Button type="button" size="sm" onClick={() => send("entry")} disabled={!draft.trim() || thinking} className="gap-2" data-testid="button-add-entry">
                        {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {thinking ? "Thinking..." : "Add to diary"}
                      </Button>
                    </div>
                  </div>
                  {lastIsUnanswered && !thinking && !errors[key] && (
                    <div className="mt-2 text-right">
                      <button type="button" className="text-[11px] text-primary hover:underline" onClick={retry} data-testid="button-request-reply">Request a response</button>
                    </div>
                  )}
                </div>

                {askOpen && (
                  <div className="border-t border-border bg-primary/5 p-3" data-testid="panel-ask">
                    <label htmlFor="diary-question" className="text-xs uppercase tracking-widest text-muted-foreground">
                      Ask about your saved entries
                    </label>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Questions are kept apart from your diary prose. Answers appear in the conversation above.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {QUESTION_STARTERS.map((p, i) => (
                        <button key={p} type="button" onClick={() => setQuestion(p)} data-testid={`button-question-starter-${i}`}
                          className="rounded-full border border-card-border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                          {p}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      id="diary-question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send("question"); }
                      }}
                      rows={3}
                      placeholder="What would you like to know about your writing?"
                      data-testid="input-diary-question"
                      className="mt-2 resize-y bg-background text-base leading-relaxed"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button type="button" size="sm" onClick={() => send("question")} disabled={!question.trim() || thinking} className="gap-2" data-testid="button-ask-question">
                        {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <HelpCircle className="h-4 w-4" />}
                        Ask
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <label htmlFor="diary-entry" className="mb-2 block text-sm text-muted-foreground">Diary entry for {diaryDateLabel(date)}</label>
                <Textarea
                  id="diary-entry"
                  value={current?.text ?? ""}
                  onChange={(e) => updateProse(e.target.value)}
                  placeholder="Write about what happened, what you noticed, how you felt, or anything you want to remember."
                  data-testid="input-diary-text"
                  className="min-h-[320px] max-h-[75vh] resize-y text-base leading-relaxed [field-sizing:content]"
                />
                <div className="mt-2 text-[11px] text-muted-foreground" data-testid="status-saved">Saves automatically as you write.</div>
              </>
            )}
          </section>

          <PastDiaryEntries entries={diary} onOpen={openEntry} onDelete={remove} />
        </>
      )}
    </div>
  );
}

function PastDiaryEntries({ entries, onOpen, onDelete }: { entries: DiaryEntry[]; onOpen: (e: DiaryEntry) => void; onDelete: (e: DiaryEntry) => void }) {
  const sorted = useMemo(
    () => [...entries]
      .filter((e) => e.text.trim() || e.draft?.trim() || e.conversation?.length)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );
  if (sorted.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Past diary entries</h2>
      <div className="space-y-3">
        {sorted.map((entry) => {
          const id = entryKeyOf(entry);
          const preview = entry.text || entry.draft || entry.conversation?.find((m) => m.role === "user")?.content || "";
          return (
            <div key={id} className="group relative rounded-xl border border-card-border bg-card hover-elevate" data-testid={`card-past-entry-${id}`}>
              <button type="button" onClick={() => onOpen(entry)} className="block w-full p-4 pr-14 text-left" data-testid={`button-open-entry-${id}`}>
                <div className="font-medium text-foreground">{diaryDateLabel(entry.date)}</div>
                <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {preview || "Empty entry"}
                </p>
              </button>
              <Button type="button" variant="ghost" size="icon" onClick={() => onDelete(entry)}
                className="absolute right-3 top-3 h-8 w-8 text-muted-foreground hover:text-destructive"
                aria-label={`Delete diary entry from ${diaryDateLabel(entry.date)}`} data-testid={`button-delete-entry-${id}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
