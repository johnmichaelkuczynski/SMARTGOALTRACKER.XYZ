import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  differenceInDays,
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
import { Ban, ChevronLeft, ChevronRight, Target, Users } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useStore } from "@/lib/storage";
import { carriedTaskOccurrencesForDate, fmt, parse, tasksForDate } from "@/lib/recurrence";
import { setViewDate, resetViewDate } from "@/lib/viewDate";
import { TaskRow } from "@/components/TaskRow";
import type { Task } from "@/lib/types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function DayView() {
  const [selected, setSelected] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const { tasks, completions, rules = [] } = useStore();
  const activeRules = useMemo(
    () => rules.filter((r) => r.status === "active"),
    [rules],
  );

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
  const carriedTasks = useMemo(
    () => carriedTaskOccurrencesForDate(tasks, completions, dateStr),
    [tasks, completions, dateStr],
  );

  const completionFor = (taskId: string, date = dateStr) =>
    completions.find((c) => c.taskId === taskId && c.date === date);

  const todo = dayTasks
    .filter((t) => !completionFor(t.id))
    .sort((a, b) => {
      const createdOrder = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return Number.isNaN(createdOrder) || createdOrder === 0
        ? b.id.localeCompare(a.id)
        : createdOrder;
    });
  const carriedTodo = [...carriedTasks].sort((a, b) =>
    b.date.localeCompare(a.date) ||
    b.task.createdAt.localeCompare(a.task.createdAt) ||
    b.task.id.localeCompare(a.task.id),
  );
  const done = dayTasks.filter((t) => completionFor(t.id));

  const credit = done.reduce(
    (sum, t) => sum + (completionFor(t.id)?.status === "partial" ? 0.5 : 1),
    0,
  );
  const dayRate = dayTasks.length ? credit / dayTasks.length : 0;

  const todayStr = fmt(new Date());

  const goals = useMemo(() => {
    const list = tasks.filter(
      (t) => !t.archived && (t.timeframe === "medium" || t.timeframe === "long"),
    );
    const now = parse(todayStr);
    return list
      .map((t) => ({ task: t, daysLeft: differenceInDays(parse(t.date), now) }))
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 7);
  }, [tasks, todayStr]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-8">
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
        <VisitorCounter />
        {activeRules.length > 0 && (
          <div className="rounded-lg border border-card-border bg-card p-4 text-sm">
            <Link
              href="/commands"
              className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 hover:text-foreground"
            >
              <Ban className="h-3 w-3" /> In force
            </Link>
            <ul className="mt-2 space-y-1.5">
              {activeRules.slice(0, 5).map((r) => (
                <li key={r.id} className="text-sm leading-snug text-foreground flex gap-1.5">
                  <span className="text-destructive mt-px shrink-0">·</span>
                  <span className="min-w-0">{r.text}</span>
                </li>
              ))}
            </ul>
            {activeRules.length > 5 && (
              <Link
                href="/commands"
                className="text-xs text-muted-foreground hover:text-foreground mt-2 inline-block"
              >
                +{activeRules.length - 5} more
              </Link>
            )}
          </div>
        )}
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
          <Column title="To do" count={todo.length + carriedTodo.length}>
            {todo.length + carriedTodo.length === 0 ? (
              <EmptyMsg>Nothing planned. Add something — or rest is a choice too.</EmptyMsg>
            ) : (
              <>
                <AnimatePresence mode="popLayout">
                  {todo.map((t) => (
                    <TaskRow key={t.id} task={t} date={dateStr} />
                  ))}
                </AnimatePresence>
                {carriedTodo.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span>Carried forward · {carriedTodo.length}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <AnimatePresence mode="popLayout">
                      {carriedTodo.map(({ task, date }) => (
                        <TaskRow
                          key={`carried-${task.id}-${date}`}
                          task={task}
                          date={date}
                          showDate
                        />
                      ))}
                    </AnimatePresence>
                  </>
                )}
              </>
            )}
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
        <div className="mt-6">
          <GoalRail goals={goals} />
        </div>
      </section>
    </div>
  );
}

function VisitorCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${basePath}/api/visitor-count`, {
      credentials: "omit",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { count?: number };
        if (!cancelled && typeof body.count === "number" && Number.isFinite(body.count)) {
          setCount(body.count);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-card-border bg-card p-4 text-sm">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Visitors
      </div>
      <div className="font-mono text-2xl mt-1">
        {count === null ? "—" : count.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground">Unique visitors</div>
    </div>
  );
}

function GoalRail({ goals }: { goals: { task: Task; daysLeft: number }[] }) {
  return (
    <div className="rounded-xl border border-card-border bg-primary/[0.04] p-4 min-h-[300px]">
      <div className="flex items-center gap-2 mb-1">
        <Target className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Keeping sight of</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Your medium &amp; long-term goals — so the day serves the bigger picture.
      </p>
      {goals.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-6 px-1 leading-snug">
          No longer-term goals yet. Add a task with a medium or long time frame and it shows up here.
        </div>
      ) : (
        <div className="space-y-2.5">
          {goals.map(({ task, daysLeft }) => (
            <GoalMini key={task.id} task={task} daysLeft={daysLeft} />
          ))}
          <Link
            href="/goals"
            className="block text-[11px] text-primary hover:underline pt-1"
          >
            See all goals →
          </Link>
        </div>
      )}
    </div>
  );
}

function GoalMini({ task, daysLeft }: { task: Task; daysLeft: number }) {
  const target = parse(task.date);
  const created = new Date(task.createdAt);
  const now = new Date();
  const total = Math.max(1, differenceInDays(target, created));
  const elapsed = Math.max(0, Math.min(total, differenceInDays(now, created)));
  const pct = Math.round((elapsed / total) * 100);

  return (
    <Link
      href="/goals"
      className="block rounded-lg border border-card-border bg-card p-3 hover-elevate"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm leading-snug text-foreground line-clamp-2">{task.title}</h4>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0 mt-0.5">
          {task.timeframe}
        </span>
      </div>
      <Progress value={pct} className="mt-2 h-1" />
      <div className="flex items-baseline justify-between mt-1.5 text-[11px] text-muted-foreground">
        <span>{format(target, "MMM d, yyyy")}</span>
        <span className="font-mono">
          {daysLeft >= 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d past`}
        </span>
      </div>
    </Link>
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
