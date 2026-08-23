import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CalendarDays, ListTodo, Search, Target, X } from "lucide-react";
import { useStore } from "@/lib/storage";
import {
  taskMatchesQuery,
  taskSearchExcerpt,
} from "@/lib/taskSearch";
import type { Task } from "@/lib/types";

export function GlobalSearchInput() {
  const { tasks } = useStore();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  const showResults = focused && Boolean(query.trim());

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setFocused(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const commandShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashShortcut = event.key === "/" && !isTyping;

      if (commandShortcut || slashShortcut) {
        event.preventDefault();
        inputRef.current?.focus();
        setFocused(true);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function openTask(taskId: string) {
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("edit-task", { detail: taskId }));
    }, 0);
  }

  return (
    <div ref={rootRef} className="relative w-44 shrink-0 xl:w-64">
      <div className="flex h-9 items-center rounded-md border border-input bg-background px-2.5 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              setFocused(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search goals & tasks"
          aria-label="Search goals, tasks, notes, and checklist items"
          aria-expanded={showResults}
          aria-controls="global-search-results"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showResults && (
        <div
          id="global-search-results"
          className="absolute right-0 top-full z-50 mt-2 w-[min(30rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="max-h-[min(60vh,520px)] overflow-y-auto p-1">
            {matches.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No tasks or goals match “{query.trim()}”.
              </div>
            ) : (
              <>
                {goals.length > 0 && (
                  <SearchGroup title={`Goals · ${goals.length}`}>
                    {goals.map((task) => (
                      <SearchResult
                        key={task.id}
                        task={task}
                        query={query}
                        onSelect={() => openTask(task.id)}
                      />
                    ))}
                  </SearchGroup>
                )}
                {dailyTasks.length > 0 && (
                  <SearchGroup title={`Tasks · ${dailyTasks.length}`}>
                    {dailyTasks.map((task) => (
                      <SearchResult
                        key={task.id}
                        task={task}
                        query={query}
                        onSelect={() => openTask(task.id)}
                      />
                    ))}
                  </SearchGroup>
                )}
              </>
            )}
          </div>
          {matches.length > 0 && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {matches.length} {matches.length === 1 ? "match" : "matches"} · Select one to open it
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden py-1">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
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
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className="flex w-full items-start gap-2 rounded-sm px-2 py-3 text-left text-sm outline-none hover:bg-accent focus:bg-accent"
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
    </button>
  );
}