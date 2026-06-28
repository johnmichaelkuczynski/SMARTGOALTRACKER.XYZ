import { useEffect, useMemo, useState } from "react";
import { differenceInDays, format, startOfDay } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, CalendarClock, Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useStore, deleteRule, endRule, reinstateRule } from "@/lib/storage";
import { parse } from "@/lib/recurrence";
import { Button } from "@/components/ui/button";
import { AddRuleDialog } from "@/components/AddRuleDialog";
import type { Rule } from "@/lib/types";

export default function Rules() {
  const { rules = [] } = useStore();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);

  const editingRule = editId ? rules.find((r) => r.id === editId) : undefined;

  useEffect(() => {
    function onEdit(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (id) {
        setEditId(id);
        setOpen(true);
      }
    }
    window.addEventListener("edit-rule", onEdit);
    return () => window.removeEventListener("edit-rule", onEdit);
  }, []);

  const active = useMemo(
    () =>
      rules
        .filter((r) => r.status === "active")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rules],
  );
  const ended = useMemo(
    () =>
      rules
        .filter((r) => r.status === "ended")
        .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "")),
    [rules],
  );

  function openCreate() {
    setEditId(undefined);
    setOpen(true);
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) setEditId(undefined);
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Commands</div>
          <h1 className="font-serif text-3xl text-foreground">Lines you won't cross</h1>
          <p className="text-muted-foreground mt-1 max-w-xl">
            Negative commands you've given yourself — what NOT to do. Standing, until a date, or
            until a condition is met.
          </p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Add command
        </Button>
      </header>

      {rules.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground italic">
          No commands yet. Add one — a line you're holding yourself to.
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              In force {active.length > 0 && <span className="font-mono">· {active.length}</span>}
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nothing in force right now.</p>
            ) : (
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {active.map((r) => (
                    <ActiveRuleCard key={r.id} rule={r} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {ended.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Lifted &amp; ended <span className="font-mono">· {ended.length}</span>
              </h2>
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {ended.map((r) => (
                    <EndedRuleCard key={r.id} rule={r} />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
        </>
      )}

      <AddRuleDialog
        key={editId ?? "new"}
        open={open}
        onOpenChange={handleOpenChange}
        editId={editId}
        defaults={editingRule}
      />
    </div>
  );
}

function BoundLabel({ rule }: { rule: Rule }) {
  if (rule.bound === "standing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        Standing
      </span>
    );
  }
  if (rule.bound === "deadline" && rule.untilDate) {
    const target = parse(rule.untilDate);
    const today = startOfDay(new Date());
    const daysLeft = differenceInDays(target, today);
    const passed = daysLeft < 0;
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] ${
          passed ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        <CalendarClock className="h-3 w-3" />
        until {format(target, "MMM d, yyyy")}
        <span className="font-mono ml-1">
          {passed ? `${Math.abs(daysLeft)}d past` : `${daysLeft}d left`}
        </span>
      </span>
    );
  }
  if (rule.bound === "condition" && rule.untilCondition) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        until {rule.untilCondition}
      </span>
    );
  }
  return null;
}

function ActiveRuleCard({ rule }: { rule: Rule }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.18 }}
      className="group rounded-lg border border-card-border bg-card px-4 py-3 flex items-start gap-3 hover-elevate"
    >
      <span className="mt-0.5 h-6 w-6 rounded-md bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
        <Ban className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-snug text-foreground font-medium">{rule.text}</div>
        {rule.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{rule.notes}</div>
        )}
        <div className="mt-1.5">
          <BoundLabel rule={rule} />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-primary"
          onClick={() => endRule(rule.id, "held")}
          title="You kept this — lift it"
        >
          <Check className="h-3.5 w-3.5" /> Held
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive"
          onClick={() => endRule(rule.id, "broken")}
          title="You broke this"
        >
          <X className="h-3.5 w-3.5" /> Broke it
        </Button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.dispatchEvent(new CustomEvent("edit-rule", { detail: rule.id }))}
            aria-label="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => deleteRule(rule.id)}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function EndedRuleCard({ rule }: { rule: Rule }) {
  const held = rule.outcome === "held";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18 }}
      className="group rounded-lg border border-card-border bg-card/60 px-4 py-2.5 flex items-start gap-3"
    >
      <span
        className={`mt-0.5 inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
          held
            ? "border-primary/50 text-primary bg-primary/10"
            : "border-destructive/50 text-destructive bg-destructive/10"
        }`}
      >
        {held ? "held" : "broken"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-snug text-muted-foreground line-through">{rule.text}</div>
        {rule.endedAt && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            ended {format(new Date(rule.endedAt), "MMM d, yyyy")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => reinstateRule(rule.id)}
          title="Bring this back into force"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reinstate
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => deleteRule(rule.id)}
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
