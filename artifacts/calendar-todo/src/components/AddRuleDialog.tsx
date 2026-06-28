import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageOcrButton } from "@/components/ImageOcrButton";
import { DocumentTextButton } from "@/components/DocumentTextButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addRule, updateRule } from "@/lib/storage";
import type { Rule, RuleBound } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaults?: Partial<Rule>;
  /** When set, the dialog edits this existing rule instead of creating a new one. */
  editId?: string;
}

export function AddRuleDialog({ open, onOpenChange, defaults, editId }: Props) {
  const isEdit = Boolean(editId);
  const today = format(new Date(), "yyyy-MM-dd");
  const [text, setText] = useState("");
  const [bound, setBound] = useState<RuleBound>("standing");
  const [untilDate, setUntilDate] = useState(today);
  const [untilCondition, setUntilCondition] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setText(defaults?.text ?? "");
      setBound(defaults?.bound ?? "standing");
      setUntilDate(defaults?.untilDate ?? today);
      setUntilCondition(defaults?.untilCondition ?? "");
      setNotes(defaults?.notes ?? "");
    }
  }, [open, defaults, today]);

  const invalid =
    !text.trim() ||
    (bound === "condition" && !untilCondition.trim()) ||
    (bound === "deadline" && !untilDate);

  function submit() {
    if (invalid) return;
    const payload = {
      text: text.trim(),
      bound,
      untilDate: bound === "deadline" ? untilDate : undefined,
      untilCondition: bound === "condition" ? untilCondition.trim() : undefined,
      notes: notes.trim() || undefined,
    };
    if (editId) {
      updateRule(editId, payload);
    } else {
      addRule(payload);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEdit ? "Edit command" : "New command"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rule-text">The command</Label>
            <Input
              id="rule-text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='e.g. "No drinking" or "No building more apps until existing ones are beta tested"'
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Phrase it as a prohibition — something you're committing NOT to do.
            </p>
          </div>

          <div className="space-y-2">
            <Label>How long does it stand?</Label>
            <Select value={bound} onValueChange={(v) => setBound(v as RuleBound)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standing">Standing — indefinitely, no end</SelectItem>
                <SelectItem value="deadline">Until a date</SelectItem>
                <SelectItem value="condition">Until a condition is met</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {bound === "deadline" && (
            <div className="space-y-2">
              <Label htmlFor="rule-until-date">In force until</Label>
              <Input
                id="rule-until-date"
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
              />
            </div>
          )}

          {bound === "condition" && (
            <div className="space-y-2">
              <Label htmlFor="rule-until-cond">In force until…</Label>
              <Input
                id="rule-until-cond"
                value={untilCondition}
                onChange={(e) => setUntilCondition(e.target.value)}
                placeholder='e.g. "existing apps have been beta tested"'
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="rule-notes">Notes (optional)</Label>
              <ImageOcrButton
                onText={(t) => setNotes((prev) => (prev ? `${prev}\n${t}` : t))}
                label="Add screenshot"
              />
              <DocumentTextButton
                onText={(t) => setNotes((prev) => (prev ? `${prev}\n${t}` : t))}
                label="Add document"
              />
            </div>
            <Textarea
              id="rule-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why this matters, what counts as breaking it, what you'll do instead."
              rows={4}
              className="min-h-[100px] text-sm leading-relaxed resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={invalid}>
            {isEdit ? "Save changes" : "Add command"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
