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
import { addTask } from "@/lib/storage";
import type { Recurrence, ScheduleType, Task, Timeframe } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaults?: Partial<Task>;
}

export function AddTaskDialog({ open, onOpenChange, defaults }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("on");
  const [date, setDate] = useState(today);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [useImportance, setUseImportance] = useState(false);
  const [importance, setImportance] = useState(5);

  useEffect(() => {
    if (open) {
      setTitle("");
      setNotes("");
      setTimeframe(defaults?.timeframe ?? "daily");
      setScheduleType(defaults?.scheduleType ?? "on");
      setDate(defaults?.date ?? today);
      setRecurrence(defaults?.recurrence ?? "none");
      setRecurrenceEndDate(defaults?.recurrenceEndDate ?? "");
      setUseImportance(typeof defaults?.importance === "number");
      setImportance(defaults?.importance ?? 5);
    }
  }, [open, defaults, today]);

  function submit() {
    if (!title.trim()) return;
    addTask({
      title: title.trim(),
      notes: notes.trim() || undefined,
      timeframe,
      scheduleType,
      date,
      recurrence: scheduleType === "by" ? "none" : recurrence,
      recurrenceEndDate: recurrenceEndDate || undefined,
      importance: useImportance ? importance : undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">New task</DialogTitle>
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

          <div className="space-y-2">
            <Label htmlFor="date">{scheduleType === "by" ? "Deadline" : "Day"}</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember about this?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>Add task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
