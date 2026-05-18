import { Link, useLocation } from "wouter";
import { useState } from "react";
import { CalendarDays, ListTodo, Target, BarChart3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeAnalytics } from "@/lib/analytics";
import { useStore } from "@/lib/storage";
import { AddTaskDialog } from "./AddTaskDialog";

const NAV = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/upcoming", label: "Due by", icon: ListTodo },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { tasks, completions } = useStore();
  const stats = computeAnalytics(tasks, completions);

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
          <Button onClick={() => setOpen(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Add
          </Button>
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
      <AddTaskDialog open={open} onOpenChange={setOpen} />
    </div>
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
