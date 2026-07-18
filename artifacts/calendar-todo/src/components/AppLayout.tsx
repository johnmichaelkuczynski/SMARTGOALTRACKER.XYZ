import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListTodo, ListChecks, Target, BarChart3, BookOpen, Brain, MessageCircle, Plus, FileText, Settings, Ban, DownloadCloud, Check, RefreshCw, CloudOff, Loader2, LogOut, ShieldCheck, FolderOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth, useLogout } from "@/lib/useAuth";
import { computeAnalytics } from "@/lib/analytics";
import { useStore, useSaveState, retrySave } from "@/lib/storage";
import { getViewDate } from "@/lib/viewDate";
import type { Task } from "@/lib/types";
import { AddTaskDialog } from "./AddTaskDialog";
import { VoiceCapture } from "./VoiceCapture";
import { RestoreDataDialog } from "./RestoreDataDialog";

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
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/informed", label: "Informed", icon: Sparkles },
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
          {NAV.map((n) => {
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

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function UserMenu() {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { data: auth } = useAuth();
  const { mutate: logout } = useLogout();

  const user = auth?.user;
  const isAuthed = auth?.authenticated;
  const initial = (user?.displayName || user?.username || "?")[0].toUpperCase();

  return (
    <>
      {!isAuthed ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { window.location.href = "/api/auth/google"; }}
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
