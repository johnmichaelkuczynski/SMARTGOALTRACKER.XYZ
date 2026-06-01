import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/storage";
import { fmt, parse, tasksForDate } from "@/lib/recurrence";
import { setViewDate, resetViewDate } from "@/lib/viewDate";
import { TaskRow } from "@/components/TaskRow";

export default function DayView() {
  const [selected, setSelected] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const { tasks, completions } = useStore();

  useEffect(() => {
    function applyHash() {
      const m = window.location.hash.match(/date=(\d{4}-\d{2}-\d{2})/);
      if (m) {
        const d = parse(m[1]);
        setSelected(d);
        setMonthAnchor(d);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    applyHash();
    function onGoto(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (!detail) return;
      const d = parse(detail);
      setSelected(d);
      setMonthAnchor(d);
    }
    window.addEventListener("goto-date", onGoto);
    window.addEventListener("hashchange", applyHash);
    return () => {
      window.removeEventListener("goto-date", onGoto);
      window.removeEventListener("hashchange", applyHash);
    };
  }, []);

  const dateStr = fmt(selected);

  useEffect(() => {
    setViewDate(dateStr);
    return () => resetViewDate();
  }, [dateStr]);

  const dayTasks = useMemo(() => tasksForDate(tasks, dateStr), [tasks, dateStr]);

  const completionFor = (taskId: string) =>
    completions.find((c) => c.taskId === taskId && c.date === dateStr);

  const todo = dayTasks.filter((t) => !completionFor(t.id));
  const done = dayTasks.filter((t) => completionFor(t.id));

  const credit = done.reduce(
    (sum, t) => sum + (completionFor(t.id)?.status === "partial" ? 0.5 : 1),
    0,
  );
  const dayRate = dayTasks.length ? credit / dayTasks.length : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
      <aside className="space-y-4">
        <MiniCalendar
          anchor={monthAnchor}
          selected={selected}
          onSelect={setSelected}
          onPrev={() => setMonthAnchor(addMonths(monthAnchor, -1))}
          onNext={() => setMonthAnchor(addMonths(monthAnchor, 1))}
          tasks={tasks}
          completions={completions}
        />
        <div className="rounded-lg border border-card-border bg-card p-4 text-sm">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">This day</div>
          <div className="font-mono text-2xl mt-1">{Math.round(dayRate * 100)}%</div>
          <div className="text-xs text-muted-foreground">
            {done.length} of {dayTasks.length} done
          </div>
        </div>
      </aside>

      <section>
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <div className="font-serif text-3xl text-foreground">
              {format(selected, "EEEE")}
            </div>
            <div className="text-muted-foreground">{format(selected, "MMMM d, yyyy")}</div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setSelected(new Date(selected.getTime() - 86400000))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(new Date()); setMonthAnchor(new Date()); }}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setSelected(new Date(selected.getTime() + 86400000))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Column title="To do" count={todo.length}>
            <AnimatePresence mode="popLayout">
              {todo.length === 0 ? (
                <EmptyMsg>Nothing planned. Add something — or rest is a choice too.</EmptyMsg>
              ) : (
                todo.map((t) => (
                  <TaskRow key={t.id} task={t} date={dateStr} />
                ))
              )}
            </AnimatePresence>
          </Column>
          <Column title="Completed" count={done.length} accent>
            <AnimatePresence mode="popLayout">
              {done.length === 0 ? (
                <EmptyMsg>Nothing checked off yet today.</EmptyMsg>
              ) : (
                done.map((t) => (
                  <TaskRow key={t.id} task={t} date={dateStr} completion={completionFor(t.id)} />
                ))
              )}
            </AnimatePresence>
          </Column>
        </div>
      </section>
    </div>
  );
}

function Column({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-card-border p-4 min-h-[300px] ${
        accent ? "bg-primary/[0.04]" : "bg-card"
      }`}
    >
      <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-border/60">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground italic py-6 px-2 text-center">{children}</div>
  );
}

interface MiniCalProps {
  anchor: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  tasks: ReturnType<typeof useStore>["tasks"];
  completions: ReturnType<typeof useStore>["completions"];
}

function MiniCalendar({ anchor, selected, onSelect, onPrev, onNext, tasks, completions }: MiniCalProps) {
  const start = startOfWeek(startOfMonth(anchor));
  const end = endOfWeek(endOfMonth(anchor));
  const days: Date[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) days.push(new Date(d));
  const today = new Date();

  return (
    <div className="rounded-lg border border-card-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrev} className="p-1 rounded hover-elevate">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium">{format(anchor, "MMMM yyyy")}</div>
        <button onClick={onNext} className="p-1 rounded hover-elevate">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map((d) => {
          const inMonth = isSameMonth(d, anchor);
          const sel = isSameDay(d, selected);
          const dayTasks = tasksForDate(tasks, fmt(d));
          const future = isAfter(d, today) && !isToday(d);
          const doneCount = dayTasks.filter((t) =>
            completions.some((c) => c.taskId === t.id && c.date === fmt(d)),
          ).length;
          const rate = dayTasks.length ? doneCount / dayTasks.length : 0;
          const dot = !future && dayTasks.length > 0;
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              className={`aspect-square text-xs rounded flex flex-col items-center justify-center relative hover-elevate ${
                sel ? "bg-primary text-primary-foreground" : ""
              } ${!inMonth ? "text-muted-foreground/40" : "text-foreground"} ${
                isToday(d) && !sel ? "ring-1 ring-primary/50" : ""
              }`}
            >
              <span>{d.getDate()}</span>
              {dot && (
                <span
                  className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                    sel ? "bg-primary-foreground" : rate === 1 ? "bg-primary" : "bg-muted-foreground/60"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
