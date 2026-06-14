import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListTodo, Target, BarChart3, BookOpen, Brain, MessageCircle, Plus, FileText, LogOut } from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { computeAnalytics } from "@/lib/analytics";
import { useStore } from "@/lib/storage";
import { getViewDate } from "@/lib/viewDate";
import type { Task } from "@/lib/types";
import { AddTaskDialog } from "./AddTaskDialog";
import { VoiceCapture } from "./VoiceCapture";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const NAV = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/upcoming", label: "Due by", icon: ListTodo },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/mind", label: "Mind", icon: Brain },
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/documents", label: "Documents", icon: FileText },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const { tasks, completions } = useStore();
  const stats = computeAnalytics(tasks, completions);

  const editingTask = editId ? tasks.find((t) => t.id === editId) : undefined;
  const createDefaults = useMemo<Partial<Task> | undefined>(
    () => (createDate ? { date: createDate, dueBy: createDate } : undefined),
    [createDate],
  );

  useEffect(() => {
    function onEdit(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (id) {
        setEditId(id);
        setOpen(true);
      }
    }
    window.addEventListener("edit-task", onEdit);
    return () => window.removeEventListener("edit-task", onEdit);
  }, []);

  function openCreate() {
    setEditId(undefined);
    setCreateDate(getViewDate());
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
          <VoiceCapture />
          <Button onClick={openCreate} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Add
          </Button>
          <UserMenu />
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-1 -mb-px">
          {NAV.map((n) => {
            const active = location === n.href;
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-4 py-3 text-sm flex items-center gap-2 border-b-2 transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-6 py-8 w-full">{children}</main>
      <AddTaskDialog
        key={editId ?? `new:${createDate ?? ""}`}
        open={open}
        onOpenChange={handleOpenChange}
        editId={editId}
        defaults={editingTask ?? createDefaults}
      />
    </div>
  );
}

function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();

  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account";
  const email = user?.primaryEmailAddress?.emailAddress;
  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.imageUrl} alt={name} />
            <AvatarFallback>{initials.toUpperCase() || name[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="leading-tight">
            <div className="text-foreground truncate">{name}</div>
            {email && email !== name && (
              <div className="text-xs font-normal text-muted-foreground truncate">{email}</div>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || "/" })}>
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
