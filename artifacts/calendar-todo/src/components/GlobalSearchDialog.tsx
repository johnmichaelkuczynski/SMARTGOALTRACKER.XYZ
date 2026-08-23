import { useMemo, useState } from "react";
import { Archive, CalendarDays, ListTodo, Target } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useStore } from "@/lib/storage";
import {
  taskMatchesQuery,
  taskSearchExcerpt,
  taskSearchText,
} from "@/lib/taskSearch";
import type { Task } from "@/lib/types";

type GlobalSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: GlobalSearchDialogProps) {
  const { tasks } = useStore();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return tasks
      .filter((task) => taskMatchesQuery(task, query))
      .sort((a, b) => {
        if (Boolean(a.archived) !== Boolean(b.archived)) {
          return a.archived ? 1 : -1;
        }
        return b.date.localeCompare(a.date);
      });
  }, [query, tasks]);

  const goals = matches.filter((task) => task.timeframe !== "daily");
  const dailyTasks = matches.filter((task) => task.timeframe === "daily");

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) setQuery("");
  }

  function openTask(taskId: string) {
    handleOpenChange(false);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("edit-task", { detail: taskId }));
    }, 0);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search tasks and goals"
      description="Search your titles, notes, and checklist items, then select a result to open it."
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tasks, goals, notes, and checklist items…"
      />
      <CommandList className="max-h-[min(60vh,520px)]">
        {!query.trim() ? (
          <div className="px-5 py-10 text-center">
            <div className="font-serif text-lg text-foreground">
              Find anything you have added
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Search titles, notes, lists, active items, completed items, and archives.
            </p>
          </div>
        ) : (
          <>
            <CommandEmpty>
              No tasks or goals match “{query.trim()}”.
            </CommandEmpty>
            {goals.length > 0 && (
              <CommandGroup heading={`Goals · ${goals.length}`}>
                {goals.map((task) => (
                  <SearchResult
                    key={task.id}
                    task={task}
                    query={query}
                    onSelect={() => openTask(task.id)}
                  />
                ))}
              </CommandGroup>
            )}
            {dailyTasks.length > 0 && (
              <CommandGroup heading={`Tasks · ${dailyTasks.length}`}>
                {dailyTasks.map((task) => (
                  <SearchResult
                    key={task.id}
                    task={task}
                    query={query}
                    onSelect={() => openTask(task.id)}
                  />
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
      {query.trim() && matches.length > 0 && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          {matches.length} {matches.length === 1 ? "match" : "matches"} · Select one to open it
        </div>
      )}
    </CommandDialog>
  );
}

function SearchResult({
  task,
  query,
  onSelect,
}: {
  task: Task;
  query: string;
  onSelect: () => void;
}) {
  const isGoal = task.timeframe !== "daily";
  const excerpt = taskSearchExcerpt(task, query);

  return (
    <CommandItem
      value={`${task.id} ${taskSearchText(task)}`}
      onSelect={onSelect}
      className="items-start py-3"
    >
      {isGoal ? (
        <Target className="mt-0.5 h-4 w-4 text-primary" />
      ) : (
        <ListTodo className="mt-0.5 h-4 w-4 text-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="font-medium text-foreground">{task.title}</span>
          {task.archived && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Archive className="h-3 w-3" />
              Archived
            </span>
          )}
        </div>
        {excerpt && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {excerpt}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{isGoal ? `${task.timeframe} goal` : "task"}</span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {task.date}
          </span>
        </div>
      </div>
    </CommandItem>
  );
}