import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { TranscribeVoiceBody, TranscribeVoiceResponse } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const MODEL = "gpt-5.4";
const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

type Logger = { error: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

/** Send raw audio bytes to AssemblyAI and block until a transcript is ready. */
async function transcribeAudio(audio: Buffer): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured");
  }

  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/octet-stream" },
    body: audio,
  });
  if (!uploadRes.ok) {
    throw new Error(`AssemblyAI upload failed (${uploadRes.status})`);
  }
  const { upload_url: uploadUrl } = (await uploadRes.json()) as { upload_url: string };

  const createRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: uploadUrl }),
  });
  if (!createRes.ok) {
    throw new Error(`AssemblyAI transcript request failed (${createRes.status})`);
  }
  const { id } = (await createRes.json()) as { id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) {
      throw new Error(`AssemblyAI poll failed (${pollRes.status})`);
    }
    const data = (await pollRes.json()) as { status: string; text?: string; error?: string };
    if (data.status === "completed") return data.text?.trim() ?? "";
    if (data.status === "error") throw new Error(data.error || "Transcription failed");
  }
  throw new Error("Transcription timed out");
}

type RawItem = {
  kind?: unknown;
  title?: unknown;
  notes?: unknown;
  timeframe?: unknown;
  date?: unknown;
  importance?: unknown;
  recurrence?: unknown;
  period?: unknown;
  periodKey?: unknown;
  text?: unknown;
};

const TIMEFRAMES = new Set(["daily", "medium", "long"]);
const RECURRENCES = new Set(["none", "daily", "weekly", "monthly"]);
const PERIODS = new Set(["day", "week", "month", "year"]);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const PARSE_SYSTEM = `You convert a person's spoken note into structured items for a calendar-style goal and to-do app.

The app holds two kinds of things:
1. TASKS — things to do or goals. Each task has:
   - title (short, imperative, e.g. "Call the dentist")
   - notes (optional extra detail the person mentioned)
   - timeframe: "daily" for everyday habits/short tasks, "medium" for goals over weeks, "long" for long-range goals
   - date: the day it belongs on, as yyyy-MM-dd. Resolve relative words ("today", "tomorrow", "next Monday", "Friday") against TODAY which is given to you. If no day is implied, use TODAY.
   - importance: an integer 1-10 ONLY if the person signalled priority/urgency; otherwise omit.
   - recurrence: "daily", "weekly", or "monthly" if they said it repeats ("every day", "each week"); otherwise "none".
2. JOURNAL — a reflection on what they did or how something went (past tense, reflective). Each journal item has:
   - period: "day", "week", "month", or "year" (usually "day")
   - periodKey: for a day, the yyyy-MM-dd it refers to (default TODAY)
   - text: the reflection, lightly cleaned up.

Rules:
- A single note may contain MULTIPLE items. Split them.
- Most notes are tasks. Only use "journal" when the person is clearly reflecting on something already done, not planning.
- Clean up filler and false starts, but never invent tasks the person didn't say.
- If the note is empty or contains nothing actionable, return an empty items array.

Respond with ONLY a JSON object of the form:
{"items":[{"kind":"task","title":"...","notes":"...","timeframe":"daily","date":"2026-06-14","importance":5,"recurrence":"none"}, {"kind":"journal","period":"day","periodKey":"2026-06-14","text":"..."}]}
Omit optional fields you don't have. Output nothing but the JSON.`;

/** Ask the model to turn a transcript into structured, validated items the client can add. */
async function extractItems(transcript: string, today: string): Promise<RawItem[]> {
  if (!transcript.trim()) return [];
  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PARSE_SYSTEM },
      { role: "user", content: `TODAY: ${today}\n\nSPOKEN NOTE:\n"""${transcript}"""` },
    ],
  });
  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    return Array.isArray(parsed.items) ? (parsed.items as RawItem[]) : [];
  } catch {
    return [];
  }
}

/** Coerce a model item into a clean VoiceItem, dropping anything malformed. */
function normalizeItem(raw: RawItem, today: string): Record<string, unknown> | null {
  const kind = str(raw.kind);
  if (kind === "journal") {
    const text = str(raw.text);
    if (!text) return null;
    const period = PERIODS.has(str(raw.period) ?? "") ? (str(raw.period) as string) : "day";
    const periodKey = str(raw.periodKey) ?? today;
    return { kind: "journal", period, periodKey, text };
  }

  // Default to a task.
  const title = str(raw.title);
  if (!title) return null;
  const timeframe = TIMEFRAMES.has(str(raw.timeframe) ?? "") ? (str(raw.timeframe) as string) : "daily";
  const recurrence = RECURRENCES.has(str(raw.recurrence) ?? "")
    ? (str(raw.recurrence) as string)
    : "none";
  const date = str(raw.date) ?? today;
  const item: Record<string, unknown> = { kind: "task", title, timeframe, recurrence, date };
  const notes = str(raw.notes);
  if (notes) item.notes = notes;
  const importance =
    typeof raw.importance === "number" && Number.isFinite(raw.importance)
      ? Math.max(1, Math.min(10, Math.round(raw.importance)))
      : undefined;
  if (importance != null) item.importance = importance;
  return item;
}

router.post("/voice/transcribe", async (req, res): Promise<void> => {
  const log = req.log as unknown as Logger;
  const parsed = TranscribeVoiceBody.safeParse(req.body);
  if (!parsed.success) {
    log.warn({ errors: parsed.error.message }, "Invalid transcribe-voice body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    res.status(500).json({ error: "Voice transcription isn't configured on the server." });
    return;
  }

  const userId = req.userId!;
  const { objectPath, today } = parsed.data;

  let audio: Buffer;
  try {
    const normalized = objectStorage.normalizeObjectEntityPath(objectPath);
    const file = await objectStorage.getObjectEntityFile(normalized);
    const [downloaded] = await file.download();
    audio = downloaded;
    await objectStorage.trySetObjectEntityAclPolicy(normalized, {
      owner: userId,
      visibility: "private",
    });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Recording not found in storage." });
      return;
    }
    log.error({ err }, "Failed to fetch uploaded recording");
    res.status(500).json({ error: "Couldn't read the recording." });
    return;
  }

  try {
    const transcript = await transcribeAudio(audio);
    const rawItems = await extractItems(transcript, today);
    const items = rawItems
      .map((it) => normalizeItem(it, today))
      .filter((it): it is Record<string, unknown> => it != null);
    res.json(TranscribeVoiceResponse.parse({ transcript, items }));
  } catch (err) {
    log.error({ err }, "Voice transcription failed");
    res.status(500).json({ error: "Couldn't transcribe that recording. Try again." });
  }
});

export default router;
