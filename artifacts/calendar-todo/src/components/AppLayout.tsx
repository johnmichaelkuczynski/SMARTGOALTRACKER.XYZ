import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListTodo, ListChecks, Target, BarChart3, BookOpen, Brain, MessageCircle, Plus, FileText, Settings, Ban, DownloadCloud, Check, RefreshCw, CloudOff, Loader2, LogOut, FolderOpen, Sparkles, Scale, Trophy, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { startGoogleSignIn, useAuth, useLogout } from "@/lib/useAuth";
import { computeAnalytics } from "@/lib/analytics";
import { useStore, useSaveState, retrySave } from "@/lib/storage";
import { getViewDate } from "@/lib/viewDate";
import type { Task } from "@/lib/types";
import { AddTaskDialog } from "./AddTaskDialog";
import { VoiceCapture } from "./VoiceCapture";
import { RestoreDataDialog } from "./RestoreDataDialog";
import { GoogleIcon } from "@/pages/AuthPages";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const NAV = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/all", label: "All tasks", icon: ListChecks },
  { href: "/commands", label: "Commands", icon: Ban },
  { href: "/upcoming", label: "Due by", icon: ListTodo },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/mind", label: "Mind", icon: Brain },
  { href: "/assistant", label: "Assistant", icon: MessageCircle, requiresAuth: true },
  { href: "/documents", label: "Documents", icon: FileText, requiresAuth: true },
  { href: "/projects", label: "Projects", icon: FolderOpen, requiresAuth: true },
  { href: "/informed", label: "Informed", icon: Sparkles, requiresAuth: true },
  { href: "/legal", label: "Legal LLM", icon: Scale, requiresAuth: true },
  { href: "/accomplishments", label: "Accomplishments", icon: Trophy, requiresAuth: true },
  { href: "/tips", label: "Tips", icon: Lightbulb, requiresAuth: true },
];

const ADMIN_EMAIL = "johnmichaelkuczynski@gmail.com";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [createExtra, setCreateExtra] = useState<Partial<Task> | undefined>(undefined);
  const { tasks, completions } = useStore();
  const stats = computeAnalytics(tasks, completions);
  const { data: auth } = useAuth();
  const isAuthenticated = Boolean(auth?.authenticated);
  const isAdmin = auth?.user?.email?.toLowerCase() === ADMIN_EMAIL;
  const editingTask = editId ? tasks.find((t) => t.id === editId) : undefined;
  const createDefaults = useMemo<Partial<Task> | undefined>(
    () => (createDate ? { date: createDate, dueBy: createDate, ...createExtra } : undefined),
    [createDate, createExtra],
  );

  useEffect(() => {
    function onEdit(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (id) {
        setEditId(id);
        setOpen(true);
      }
    }
    function onCreate(e: Event) {
      const detail = (e as CustomEvent<Partial<Task>>).detail;
      setEditId(undefined);
      setCreateDate(getViewDate());
      setCreateExtra(detail || undefined);
      setOpen(true);
    }
    window.addEventListener("edit-task", onEdit);
    window.addEventListener("create-task", onCreate as EventListener);
    return () => {
      window.removeEventListener("edit-task", onEdit);
      window.removeEventListener("create-task", onCreate as EventListener);
    };
  }, []);

  function openCreate() {
    setEditId(undefined);
    setCreateDate(getViewDate());
    setCreateExtra(location === "/goals" ? { timeframe: "medium" } : undefined);
    setOpen(true);
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) setEditId(undefined);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
          <div className="flex items-baseline gap-3">
            <div className="font-serif text-2xl tracking-tight text-foreground">Goal Tracker</div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground hidden sm:block">
              honest follow-through
            </div>
          </div>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-6 text-sm">
            <Stat label="Overall" value={`${Math.round(stats.overall.rate * 100)}%`} />
            <Stat label="Daily" value={`${Math.round(stats.byTimeframe.daily.rate * 100)}%`} />
            <Stat label="Medium" value={`${Math.round(stats.byTimeframe.medium.rate * 100)}%`} />
            <Stat label="Long" value={`${Math.round(stats.byTimeframe.long.rate * 100)}%`} />
          </div>
          <SaveIndicator />
          <VoiceCapture />
          <Button onClick={openCreate} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Add
          </Button>
          <UserMenu />
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-0 -mb-px">
          {NAV.filter((n) => isAuthenticated || !n.requiresAuth).map((n) => {
            const active = location === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/admin"
              className={`px-3 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
                location === "/admin"
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-6 py-8 w-full">{children}</main>
      <AddTaskDialog
        key={editId ?? `new:${createDate ?? ""}:${createExtra?.timeframe ?? ""}`}
        open={open}
        onOpenChange={handleOpenChange}
        editId={editId}
        defaults={editingTask ?? createDefaults}
      />
    </div>
  );
}

function UserMenu() {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { data: auth } = useAuth();
  const { mutate: logout } = useLogout();
  const user = auth?.user;
  const isAuthenticated = auth?.authenticated;
  const initial = (user?.displayName || user?.username || "?")[0].toUpperCase();

  return (
    <>
      {!isAuthenticated ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void startGoogleSignIn();
            }}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <GoogleIcon className="h-4 w-4 shrink-0" />
            Sign in
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Settings"
              >
                <Settings className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setRestoreOpen(true)}>
                <DownloadCloud className="h-4 w-4" />
                Restore / back up data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Account menu"
            >
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-semibold text-primary-foreground select-none">
                {initial}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="leading-tight">
                <div className="text-foreground truncate font-medium">
                  {user?.displayName || user?.username}
                </div>
                {user?.email && (
                  <div className="text-xs font-normal text-muted-foreground truncate">
                    {user.email}
                  </div>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setRestoreOpen(true)}>
              <DownloadCloud className="h-4 w-4" />
              Restore / back up data
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <RestoreDataDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </>
  );
}

function SaveIndicator() {
  const saveState = useSaveState();
  if (saveState === "idle") return null;
  if (saveState === "saving") {
    return (
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
      </span>
    );
  }
  if (saveState === "saved") {
    return (
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => retrySave()}
      title="Your latest changes haven't synced to your database yet. Click to retry."
      className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <CloudOff className="h-3.5 w-3.5" /> Not synced
      <RefreshCw className="h-3 w-3" />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <div className="font-mono text-base text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
