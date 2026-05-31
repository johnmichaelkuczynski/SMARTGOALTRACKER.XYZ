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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { addTask, updateTask } from "@/lib/storage";
import type { Recurrence, ScheduleType, Task, Timeframe } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaults?: Partial<Task>;
  /** When set, the dialog edits this existing task instead of creating a new one. */
  editId?: string;
}

export function AddTaskDialog({ open, onOpenChange, defaults, editId }: Props) {
  const isEdit = Boolean(editId);
  const today = format(new Date(), "yyyy-MM-dd");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("on");
  const [date, setDate] = useState(today);
  const [dueBy, setDueBy] = useState(today);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [useImportance, setUseImportance] = useState(false);
  const [importance, setImportance] = useState(5);

  useEffect(() => {
    if (open) {
      setTitle(isEdit ? (defaults?.title ?? "") : "");
      setNotes(isEdit ? (defaults?.notes ?? "") : "");
      setTimeframe(defaults?.timeframe ?? "daily");
      setScheduleType(defaults?.scheduleType ?? "on");
      setDate(defaults?.date ?? today);
      setDueBy(defaults?.dueBy ?? defaults?.date ?? today);
      setRecurrence(defaults?.recurrence ?? "none");
      setRecurrenceEndDate(defaults?.recurrenceEndDate ?? "");
      setUseImportance(typeof defaults?.importance === "number");
      setImportance(defaults?.importance ?? 5);
    }
  }, [open, defaults, today]);

  function submit() {
    if (!title.trim()) return;
    const payload = {
      title: title.trim(),
      notes: notes.trim() || undefined,
      timeframe,
      scheduleType,
      date,
      dueBy: scheduleType === "on" && dueBy && dueBy !== date ? dueBy : undefined,
      recurrence: scheduleType === "by" ? ("none" as Recurrence) : recurrence,
      recurrenceEndDate: recurrenceEndDate || undefined,
      importance: useImportance ? importance : undefined,
    };
    if (editId) {
      updateTask(editId, payload);
    } else {
      addTask(payload);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">{isEdit ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Time frame</Label>
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="medium">Medium-term goal</SelectItem>
                  <SelectItem value="long">Long-term goal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Schedule</Label>
              <Select value={scheduleType} onValueChange={(v) => setScheduleType(v as ScheduleType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">On this day</SelectItem>
                  <SelectItem value="by">By this day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={scheduleType === "on" ? "grid grid-cols-2 gap-3" : "space-y-2"}>
            <div className="space-y-2">
              <Label htmlFor="date">{scheduleType === "by" ? "Deadline" : "Day"}</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => {
                  const v = e.target.value;
                  setDate(v);
                  if (!dueBy || dueBy < v) setDueBy(v);
                }}
              />
            </div>
            {scheduleType === "on" && (
              <div className="space-y-2">
                <Label htmlFor="dueBy">Due by</Label>
                <Input
                  id="dueBy"
                  type="date"
                  value={dueBy}
                  min={date}
                  onChange={(e) => setDueBy(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Defaults to the same day. Set a later date to give yourself a deadline.
                </p>
              </div>
            )}
          </div>

          {scheduleType === "on" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Repeat</Label>
                <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Does not repeat</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {recurrence !== "none" && (
                <div className="space-y-2">
                  <Label>Ends (optional)</Label>
                  <Input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={useImportance}
                  onChange={(e) => setUseImportance(e.target.checked)}
                />
                Importance (optional)
              </Label>
              {useImportance && (
                <span className="font-mono text-sm text-primary">{importance}/10</span>
              )}
            </div>
            {useImportance && (
              <Slider
                value={[importance]}
                min={1}
                max={10}
                step={1}
                onValueChange={(v) => setImportance(v[0])}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-base">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe this task to yourself — what it actually means, why it matters, what done looks like, anything you'll want to remember when you come back to it."
              rows={12}
              className="min-h-[260px] text-base leading-relaxed resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>{isEdit ? "Save changes" : "Add task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
