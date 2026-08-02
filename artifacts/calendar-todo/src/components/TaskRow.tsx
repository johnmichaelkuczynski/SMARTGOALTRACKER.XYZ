import { motion } from "framer-motion";
import { format } from "date-fns";
import { Trash2, Repeat, CalendarClock, Clock, Pencil, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteTask, toggleSubtask } from "@/lib/storage";
import { CompletionControl } from "@/components/CompletionControl";
import type { Completion, Task } from "@/lib/types";
import { parse } from "@/lib/recurrence";

interface Props {
  task: Task;
  date: string;
  completion?: Completion;
  showDate?: boolean;
  /** Hide the interactive completion control (used on management views where completing by a single date would be misleading, e.g. recurring tasks on the All-tasks page). */
  hideCompletion?: boolean;
}

export function TaskRow({ task, date, completion, showDate, hideCompletion }: Props) {
  const status = completion ? (completion.status ?? "done") : null;
  const completed = status !== null;
  const dueDate = task.scheduleType === "by" ? parse(task.date) : null;
  const dueByDate = task.scheduleType === "on" && task.dueBy && task.dueBy !== task.date
    ? parse(task.dueBy)
    : null;

  function formatTime(t: string): string {
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return t;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return format(d, "h:mm a");
  }

  function gotoDate(dateStr: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("goto-date", { detail: dateStr }));
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: completed ? 12 : -12 }}
      transition={{ duration: 0.18 }}
      className={`group rounded-lg border border-card-border bg-card px-3 py-2.5 flex items-start gap-3 hover-elevate ${
        completed ? "opacity-90" : ""
      }`}
    >
      {hideCompletion ? (
        <span
          className="mt-0.5 h-5 w-5 rounded-md border border-dashed border-input flex items-center justify-center shrink-0 text-muted-foreground"
          title="Recurring task — complete it from a specific day"
        >
          <Repeat className="h-3 w-3" />
        </span>
      ) : (
        <CompletionControl taskId={task.id} date={date} completion={completion} />
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-sm leading-snug ${status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </div>
        {task.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{task.notes}</div>
        )}
        {task.subtasks && task.subtasks.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {task.subtasks.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggleSubtask(task.id, s.id)}
                  className="flex items-start gap-1.5 text-left w-full group/sub"
                >
                  {s.doneAt
                    ? <CheckSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                    : <Square className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground group-hover/sub:text-foreground transition-colors" />
                  }
                  <span className={`text-xs leading-snug ${s.doneAt ? "line-through text-muted-foreground" : "text-foreground/80 group-hover/sub:text-foreground transition-colors"}`}>
                    {s.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {completion?.comment && (
          <div
            className={`text-xs mt-1 leading-snug rounded-md px-2 py-1 ${
              status === "partial"
                ? "bg-amber-400/15 text-amber-800 dark:text-amber-300"
                : "bg-primary/10 text-foreground/80"
            }`}
          >
            <span className="uppercase tracking-wider text-[9px] font-semibold mr-1">
              {status === "partial" ? "Left to do" : "Note"}
            </span>
            {completion.comment}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {status === "partial" && (
            <span className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-700 bg-amber-400/15">
              partial
            </span>
          )}
          {task.time && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/80">
              <Clock className="h-3 w-3" />
              {formatTime(task.time)}
            </span>
          )}
          {task.scheduleType === "by" && dueDate && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              by {format(dueDate, "MMM d")}
            </span>
          )}
          {dueByDate && task.dueBy && (
            <a
              href={`#date=${task.dueBy}`}
              onClick={(e) => gotoDate(task.dueBy!, e)}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              title={`Jump to ${format(dueByDate, "EEEE, MMMM d, yyyy")}`}
            >
              <CalendarClock className="h-3 w-3" />
              due by {format(dueByDate, "MMM d")}
            </a>
          )}
          {task.recurrence !== "none" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Repeat className="h-3 w-3" />
              {task.recurrence}
            </span>
          )}
          {showDate && (
            <span className="text-[11px] text-muted-foreground">
              {format(parse(date), "MMM d")}
            </span>
          )}
          {typeof task.importance === "number" && (
            <span
              className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
              style={{
                color: `hsl(25 ${20 + task.importance * 6}% ${55 - task.importance * 2}%)`,
                borderColor: `hsl(25 30% 80%)`,
                background: `hsla(25, ${40 + task.importance * 4}%, 90%, .4)`,
              }}
            >
              i{task.importance}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground ml-auto">
            {task.timeframe === "daily" ? "daily" : task.timeframe === "medium" ? "medium" : "long"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => window.dispatchEvent(new CustomEvent("edit-task", { detail: task.id }))}
          aria-label="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => deleteTask(task.id)}
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
