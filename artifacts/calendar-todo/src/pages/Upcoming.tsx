import { differenceInDays, format, isToday, startOfDay } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { useStore } from "@/lib/storage";
import { dueByItems } from "@/lib/analytics";
import { TaskRow } from "@/components/TaskRow";
import { fmt } from "@/lib/recurrence";

export default function Upcoming() {
  const { tasks, completions } = useStore();
  const items = dueByItems(tasks, completions);
  const today = startOfDay(new Date());

  const overdue = items.filter((i) => i.overdue);
  const todayItems = items.filter((i) => isToday(i.dueDate) && !i.overdue);
  const upcoming = items.filter((i) => !i.overdue && !isToday(i.dueDate));

  return (
    <div className="space-y-10">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Due by</div>
        <h1 className="font-serif text-3xl text-foreground">What you owe future you</h1>
        <p className="text-muted-foreground mt-1">
          Items with a deadline rather than a fixed day. Sorted by what's due soonest.
        </p>
      </header>

      {items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground italic">
          No deadlines on the horizon. Add something with a "by" date to see it here.
        </div>
      )}

      {overdue.length > 0 && (
        <Section title="Overdue" tone="destructive">
          <AnimatePresence mode="popLayout">
            {overdue.map(({ task, dueDate }) => (
              <TaskRow
                key={task.id}
                task={task}
                date={fmt(dueDate)}
                completed={false}
                showDate
              />
            ))}
          </AnimatePresence>
          {overdue.map(({ task, dueDate }) => (
            <DaysHint
              key={`${task.id}-h`}
              label={`${Math.abs(differenceInDays(dueDate, today))} days overdue`}
            />
          ))}
        </Section>
      )}

      {todayItems.length > 0 && (
        <Section title="Today">
          <AnimatePresence mode="popLayout">
            {todayItems.map(({ task, dueDate }) => (
              <TaskRow key={task.id} task={task} date={fmt(dueDate)} completed={false} />
            ))}
          </AnimatePresence>
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Upcoming">
          <AnimatePresence mode="popLayout">
            {upcoming.map(({ task, dueDate }) => (
              <div key={task.id} className="space-y-1">
                <TaskRow task={task} date={fmt(dueDate)} completed={false} showDate />
                <div className="pl-8 text-[11px] text-muted-foreground">
                  in {differenceInDays(dueDate, today)} days — {format(dueDate, "EEEE, MMMM d")}
                </div>
              </div>
            ))}
          </AnimatePresence>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className={`text-xs uppercase tracking-widest mb-3 ${
          tone === "destructive" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DaysHint({ label }: { label: string }) {
  return null;
  // visual hint kept inline above; placeholder retained for layout simplicity
  // eslint-disable-next-line no-unreachable
  return <div className="text-[11px] text-destructive pl-8">{label}</div>;
}
