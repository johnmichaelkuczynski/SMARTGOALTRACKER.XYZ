import { useState } from "react";
import { Check, Minus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setCompletion, clearCompletion } from "@/lib/storage";
import type { Completion } from "@/lib/types";

interface Props {
  taskId: string;
  date: string;
  completion?: Completion;
}

type View = "menu" | "done-note" | "partial-note";

export function CompletionControl({ taskId, date, completion }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [comment, setComment] = useState("");

  const status = completion ? (completion.status ?? "done") : null;

  function start(next: View) {
    setComment(completion?.comment ?? "");
    setView(next);
  }

  function close() {
    setOpen(false);
    setView("menu");
    setComment("");
  }

  function markDone() {
    setCompletion(taskId, date, "done");
    close();
  }

  function saveDoneNote() {
    setCompletion(taskId, date, "done", comment);
    close();
  }

  function savePartial() {
    setCompletion(taskId, date, "partial", comment);
    close();
  }

  function clear() {
    clearCompletion(taskId, date);
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setView("menu");
          setComment("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
            status === "done"
              ? "bg-primary border-primary text-primary-foreground"
              : status === "partial"
                ? "bg-amber-400/80 border-amber-500 text-amber-950"
                : "border-input hover:border-primary"
          }`}
          aria-label={status ? "Edit completion" : "Mark complete"}
        >
          {status === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          {status === "partial" && <Minus className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {view === "menu" && (
          <div className="space-y-1">
            {status && (
              <div className="px-2 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                {status === "done" ? "Marked done" : "Partially done"}
              </div>
            )}
            <MenuButton onClick={markDone}>
              <Check className="h-4 w-4 text-primary" /> Done
            </MenuButton>
            <MenuButton onClick={() => start("done-note")}>
              <Check className="h-4 w-4 text-primary" /> Done — with a note
            </MenuButton>
            <MenuButton onClick={() => start("partial-note")}>
              <Minus className="h-4 w-4 text-amber-600" /> Partially done — what's left
            </MenuButton>
            {status && (
              <>
                <div className="h-px bg-border my-1" />
                <MenuButton onClick={clear}>
                  <span className="h-4 w-4 inline-flex items-center justify-center text-muted-foreground">○</span>
                  Move back to to-do
                </MenuButton>
              </>
            )}
          </div>
        )}

        {view === "done-note" && (
          <NoteForm
            title="Done — anything to note?"
            placeholder="How it went, what you produced, links, etc."
            value={comment}
            onChange={setComment}
            onCancel={() => setView("menu")}
            onSave={saveDoneNote}
            saveLabel="Mark done"
          />
        )}

        {view === "partial-note" && (
          <NoteForm
            title="Partially done — what's left?"
            placeholder="What still needs doing to call this finished?"
            value={comment}
            onChange={setComment}
            onCancel={() => setView("menu")}
            onSave={savePartial}
            saveLabel="Mark partial"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 hover-elevate"
    >
      {children}
    </button>
  );
}

function NoteForm({
  title,
  placeholder,
  value,
  onChange,
  onCancel,
  onSave,
  saveLabel,
}: {
  title: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
}) {
  return (
    <div className="space-y-2 p-1">
      <div className="text-sm font-medium">{title}</div>
      <Textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="text-sm resize-y min-h-[90px]"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Back
        </Button>
        <Button size="sm" onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
