export type DiaryWritingRecord = Record<string, unknown>;

export const DIARY_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "themes", "changes", "suggestions"],
  properties: {
    summary: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "observation", "dates"],
        properties: {
          title: { type: "string" },
          observation: { type: "string" },
          dates: { type: "array", items: { type: "string" } },
        },
      },
    },
    changes: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
  },
} as const;

export function validDiaryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Only the user's prose/draft is writing; AI replies and questions are not. */
export function diaryWriting(entry: DiaryWritingRecord): string {
  const text = typeof entry.text === "string" ? entry.text : "";
  const draft = typeof entry.draft === "string" ? entry.draft : "";
  return (text.trim() === draft.trim() ? text : [text, draft].filter(Boolean).join("\n\n")).trim();
}

export function selectDiaryWriting(
  entries: DiaryWritingRecord[],
  from?: string,
  to?: string,
) {
  return entries.flatMap((entry) => {
    const date = typeof entry.date === "string" ? entry.date : "";
    const text = diaryWriting(entry);
    if (!validDiaryDate(date) || !text || (from && date < from) || (to && date > to)) return [];
    return [{ id: typeof entry.id === "string" ? entry.id : `legacy:${date}`, date, text }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function diaryWritingStats(entries: ReturnType<typeof selectDiaryWriting>) {
  return {
    entryCount: entries.length,
    writingDays: new Set(entries.map((entry) => entry.date)).size,
    wordCount: entries.reduce((count, entry) => count + entry.text.split(/\s+/u).length, 0),
    from: entries[0]?.date ?? "",
    to: entries.at(-1)?.date ?? "",
  };
}

export function conciseDiaryParagraph(text: string, maxWords = 120): string {
  const paragraph = text.replace(/\s+/gu, " ").trim();
  const words = paragraph.split(" ");
  return words.length <= maxWords ? paragraph : `${words.slice(0, maxWords).join(" ")}…`;
}
