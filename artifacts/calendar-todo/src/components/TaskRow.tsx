import { motion } from "framer-motion";
import { format } from "date-fns";
import { Check, Trash2, Repeat, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteTask, toggleCompletion } from "@/lib/storage";
import type { Task } from "@/lib/types";
import { parse } from "@/lib/recurrence";

interface Props {
  task: Task;
  date: string;
  completed: boolean;
  showDate?: boolean;
}

export function TaskRow({ task, date, completed, showDate }: Props) {
  const dueDate = task.scheduleType === "by" ? parse(task.date) : null;
  const dueByDate = task.scheduleType === "on" && task.dueBy && task.dueBy !== task.date
    ? parse(task.dueBy)
    : null;

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
        completed ? "opacity-80" : ""
      }`}
    >
      <button
        onClick={() => toggleCompletion(task.id, date)}
        className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
          completed
            ? "bg-primary border-primary text-primary-foreground"
            : "border-input hover:border-primary"
        }`}
        aria-label={completed ? "Mark incomplete" : "Mark complete"}
      >
        {completed && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm leading-snug ${completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </div>
        {task.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{task.notes}</div>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => {
          deleteTask(task.id);
        }}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </motion.div>
  );
}
