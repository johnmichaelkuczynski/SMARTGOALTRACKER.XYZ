import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import { useStore } from "@/lib/storage";
import { Input } from "@/components/ui/input";
import { TaskRow } from "@/components/TaskRow";
import type { Completion, Task, Timeframe } from "@/lib/types";

type StatusFilter = "all" | "active" | "completed";
type TimeframeFilter = "all" | Timeframe;

function taskStatus(
  task: Task,
  completions: Completion[],
): "recurring" | "active" | "partial" | "done" {
  if (task.recurrence !== "none") return "recurring";
  const c = completions.find((c) => c.taskId === task.id && c.date === task.date);
  if (!c) return "active";
  return c.status ?? "done";
}

export default function AllTasks() {
  const { tasks, completions } = useStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [timeframe, setTimeframe] = useState<TimeframeFilter>("all");
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => (showArchived ? !!t.archived : !t.archived))
      .filter((t) => timeframe === "all" || t.timeframe === timeframe)
      .filter((t) => {
        if (status === "all") return true;
        const s = taskStatus(t, completions);
        const isDone = s === "done" || s === "partial";
        return status === "completed" ? isDone : !isDone;
      })
      .filter((t) => {
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [tasks, completions, query, status, timeframe, showArchived]);

  const completionFor = (taskId: string, date: string) =>
    completions.find((c) => c.taskId === taskId && c.date === date);

  const activeTotal = tasks.filter((t) => !t.archived).length;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">All tasks</div>
        <h1 className="font-serif text-3xl text-foreground">Everything you've added</h1>
        <p className="text-muted-foreground mt-1">
          Every task, regardless of date — so nothing is ever hidden. Search, filter, edit, or delete.
        </p>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or notes..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Status">
            <Chip active={status === "all"} onClick={() => setStatus("all")}>All</Chip>
            <Chip active={status === "active"} onClick={() => setStatus("active")}>Active</Chip>
            <Chip active={status === "completed"} onClick={() => setStatus("completed")}>Completed</Chip>
          </FilterGroup>
          <span className="h-5 w-px bg-border mx-1" />
          <FilterGroup label="Type">
            <Chip active={timeframe === "all"} onClick={() => setTimeframe("all")}>All</Chip>
            <Chip active={timeframe === "daily"} onClick={() => setTimeframe("daily")}>Daily</Chip>
            <Chip active={timeframe === "medium"} onClick={() => setTimeframe("medium")}>Medium</Chip>
            <Chip active={timeframe === "long"} onClick={() => setTimeframe("long")}>Long</Chip>
          </FilterGroup>
          <span className="h-5 w-px bg-border mx-1" />
          <Chip active={showArchived} onClick={() => setShowArchived((v) => !v)}>
            Archived
          </Chip>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} {showArchived ? "archived" : `of ${activeTotal}`}
        {!showArchived && activeTotal === 1 ? " task" : " tasks"}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground italic">
          {tasks.length === 0
            ? "No tasks yet. Hit Add to create your first one."
            : "Nothing matches these filters."}
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {filtered.map((t) => {
              const recurring = t.recurrence !== "none";
              return (
                <TaskRow
                  key={t.id}
                  task={t}
                  date={t.date}
                  completion={recurring ? undefined : completionFor(t.id, t.date)}
                  showDate
                  hideCompletion={recurring}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-0.5">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover-elevate"
      }`}
    >
      {children}
    </button>
  );
}
