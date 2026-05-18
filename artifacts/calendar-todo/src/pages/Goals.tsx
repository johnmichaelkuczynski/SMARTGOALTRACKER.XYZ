import { differenceInDays, format } from "date-fns";
import { useStore } from "@/lib/storage";
import { parse } from "@/lib/recurrence";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { deleteTask } from "@/lib/storage";
import { Trash2 } from "lucide-react";
import type { Task } from "@/lib/types";

export default function Goals() {
  const { tasks, completions } = useStore();
  const medium = tasks.filter((t) => !t.archived && t.timeframe === "medium");
  const long = tasks.filter((t) => !t.archived && t.timeframe === "long");

  return (
    <div className="space-y-12">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Goals</div>
        <h1 className="font-serif text-3xl text-foreground">The longer view</h1>
        <p className="text-muted-foreground mt-1">
          You set what counts as medium and long term. We just hold the dates.
        </p>
      </header>

      <GoalSection title="Medium-term" subtitle="Months out. The next mile-marker." goals={medium} completions={completions} />
      <GoalSection title="Long-term" subtitle="Years out. Where this is all going." goals={long} completions={completions} />
    </div>
  );
}

function GoalSection({
  title,
  subtitle,
  goals,
  completions,
}: {
  title: string;
  subtitle: string;
  goals: Task[];
  completions: ReturnType<typeof useStore>["completions"];
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-serif text-xl text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {goals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground italic">
          Nothing here yet. Add a task with "{title.toLowerCase()}" as its time frame.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} completions={completions} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalCard({ goal, completions }: { goal: Task; completions: ReturnType<typeof useStore>["completions"] }) {
  const target = parse(goal.date);
  const created = new Date(goal.createdAt);
  const now = new Date();
  const total = Math.max(1, differenceInDays(target, created));
  const elapsed = Math.max(0, Math.min(total, differenceInDays(now, created)));
  const pct = Math.round((elapsed / total) * 100);
  const daysLeft = differenceInDays(target, now);
  const done = completions.some((c) => c.taskId === goal.id);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 group hover-elevate">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <h3 className="font-medium text-foreground leading-tight">{goal.title}</h3>
          {goal.notes && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{goal.notes}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={() => {
            if (confirm(`Delete "${goal.title}"?`)) deleteTask(goal.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground mt-3">
        <span>Target {format(target, "MMM d, yyyy")}</span>
        <span className="font-mono">
          {daysLeft >= 0 ? `${daysLeft} days left` : `${Math.abs(daysLeft)} days past`}
        </span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <div className="flex items-center justify-between mt-3 text-[11px]">
        <span className="text-muted-foreground">
          {typeof goal.importance === "number" ? `Importance ${goal.importance}/10` : "No importance set"}
        </span>
        <span
          className={`uppercase tracking-widest ${
            done ? "text-primary" : daysLeft < 0 ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {done ? "Achieved" : daysLeft < 0 ? "Missed" : "In progress"}
        </span>
      </div>
    </div>
  );
}
