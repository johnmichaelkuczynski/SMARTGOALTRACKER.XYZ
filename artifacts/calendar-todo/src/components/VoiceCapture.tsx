import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Check, ListTodo, BookOpen } from "lucide-react";
import { requestUploadUrl, transcribeVoice } from "@workspace/api-client-react";
import type { VoiceItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { addTask, setJournalEntry, getJournalEntry } from "@/lib/storage";
import { fmt } from "@/lib/recurrence";
import type { JournalPeriod, Recurrence, Timeframe } from "@/lib/types";

type Phase = "idle" | "recording" | "processing" | "review" | "error";

const TIMEFRAME_LABEL: Record<string, string> = {
  daily: "Daily",
  medium: "Medium-term",
  long: "Long-term",
};

function mins(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceCapture() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const genRef = useRef(0);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => stopTracks, []);

  function reset() {
    genRef.current += 1;
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null;
      rec.ondataavailable = null;
      if (rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // already stopped
        }
      }
    }
    stopTracks();
    recorderRef.current = null;
    chunksRef.current = [];
    setPhase("idle");
    setSeconds(0);
    setTranscript("");
    setItems([]);
    setSelected({});
    setError(null);
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) reset();
  }

  async function startRecording() {
    const gen = ++genRef.current;
    setError(null);
    setTranscript("");
    setItems([]);
    setSelected({});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen !== genRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void processRecording(gen);
      };
      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Couldn't access the microphone. Check your browser permissions and try again.");
      setPhase("error");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setPhase("processing");
    }
  }

  async function processRecording(gen: number) {
    const type = recorderRef.current?.mimeType || "audio/webm";
    stopTracks();
    const blob = new Blob(chunksRef.current, { type });
    if (gen !== genRef.current) return;
    if (blob.size === 0) {
      setError("That recording was empty. Try again.");
      setPhase("error");
      return;
    }
    try {
      const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: `voice-note.${ext}`,
        size: blob.size,
        contentType: type,
      });
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": type },
        body: blob,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const result = await transcribeVoice({ objectPath, today: fmt(new Date()) });
      if (gen !== genRef.current) return;
      const got = result.items ?? [];
      setTranscript(result.transcript ?? "");
      setItems(got);
      setSelected(Object.fromEntries(got.map((_, i) => [i, true])));
      setPhase("review");
    } catch {
      if (gen !== genRef.current) return;
      setError("Couldn't transcribe that recording. Try again.");
      setPhase("error");
    }
  }

  function applySelected() {
    const today = fmt(new Date());
    items.forEach((item, i) => {
      if (!selected[i]) return;
      if (item.kind === "journal") {
        const period = (item.period as JournalPeriod) || "day";
        const periodKey = item.periodKey || today;
        const text = (item.text || "").trim();
        if (!text) return;
        const existing = getJournalEntry(period, periodKey)?.text?.trim();
        setJournalEntry(period, periodKey, existing ? `${existing}\n\n${text}` : text);
      } else {
        const title = (item.title || "").trim();
        if (!title) return;
        addTask({
          title,
          notes: item.notes || undefined,
          timeframe: (item.timeframe as Timeframe) || "daily",
          scheduleType: "on",
          date: item.date || today,
          importance: item.importance ?? undefined,
          recurrence: (item.recurrence as Recurrence) || "none",
          archived: false,
        });
      }
    });
    handleOpenChange(false);
  }

  const selectedCount = items.filter((_, i) => selected[i]).length;

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          void startRecording();
        }}
        size="sm"
        variant="outline"
        className="gap-2"
        aria-label="Dictate by voice"
      >
        <Mic className="h-4 w-4" />
        <span className="hidden sm:inline">Dictate</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dictate</DialogTitle>
            <DialogDescription>
              Say what you want to add — to-dos, goals, or a reflection. You'll review before anything is saved.
            </DialogDescription>
          </DialogHeader>

          {phase === "recording" && (
            <div className="flex flex-col items-center gap-5 py-8">
              <div className="relative flex items-center justify-center">
                <span className="absolute inline-flex h-20 w-20 rounded-full bg-primary/20 animate-ping" />
                <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Mic className="h-7 w-7" />
                </span>
              </div>
              <div className="font-mono text-2xl text-foreground">{mins(seconds)}</div>
              <p className="text-sm text-muted-foreground">Listening… speak naturally.</p>
              <Button onClick={stopRecording} className="gap-2">
                <Square className="h-4 w-4" /> Stop
              </Button>
            </div>
          )}

          {phase === "processing" && (
            <div className="flex flex-col items-center gap-4 py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Transcribing and reading what you said…</p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button onClick={() => void startRecording()} className="gap-2">
                <Mic className="h-4 w-4" /> Try again
              </Button>
            </div>
          )}

          {phase === "review" && (
            <div className="space-y-5">
              {transcript && (
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground italic">
                  "{transcript}"
                </div>
              )}

              {items.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nothing to add from that. Try again and be specific about what you want entered.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {items.map((item, i) => {
                    const isJournal = item.kind === "journal";
                    return (
                      <label
                        key={i}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={!!selected[i]}
                          onCheckedChange={(v) =>
                            setSelected((prev) => ({ ...prev, [i]: v === true }))
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="gap-1">
                              {isJournal ? (
                                <BookOpen className="h-3 w-3" />
                              ) : (
                                <ListTodo className="h-3 w-3" />
                              )}
                              {isJournal ? "Reflection" : "To-do"}
                            </Badge>
                            {!isJournal && item.timeframe && (
                              <span className="text-xs text-muted-foreground">
                                {TIMEFRAME_LABEL[item.timeframe] ?? item.timeframe}
                              </span>
                            )}
                            {!isJournal && item.date && (
                              <span className="text-xs text-muted-foreground">· {item.date}</span>
                            )}
                            {!isJournal && item.recurrence && item.recurrence !== "none" && (
                              <span className="text-xs text-muted-foreground">· {item.recurrence}</span>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-foreground break-words">
                            {isJournal ? item.text : item.title}
                          </div>
                          {!isJournal && item.notes && (
                            <div className="mt-0.5 text-xs text-muted-foreground break-words">
                              {item.notes}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="ghost" onClick={() => void startRecording()} className="gap-2">
                  <Mic className="h-4 w-4" /> Record again
                </Button>
                <Button onClick={applySelected} disabled={selectedCount === 0} className="gap-2">
                  <Check className="h-4 w-4" />
                  Add {selectedCount > 0 ? selectedCount : ""}{" "}
                  {selectedCount === 1 ? "item" : "items"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
