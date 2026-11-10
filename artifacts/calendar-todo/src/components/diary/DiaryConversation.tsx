import { useEffect, useRef } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichMessageContent } from "@/components/RichMessageContent";
import type { DiaryEntry } from "@/lib/types";

export function DiaryConversation({
  entry,
  thinking,
  error,
  onRetry,
}: {
  entry: DiaryEntry | undefined;
  thinking: boolean;
  error: string;
  onRetry: () => void;
}) {
  const conversation = entry?.conversation ?? [];
  const conversationProse = conversation
    .filter((message) => message.role === "user" && message.kind !== "question")
    .map((message) => message.content).join("\n\n");
  const priorProse = conversationProse && entry?.text.endsWith(conversationProse)
    ? entry.text.slice(0, -conversationProse.length).trimEnd()
    : entry?.text ?? "";
  const showProse = !!priorProse.trim();
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [conversation.length, thinking, error]);
  if (!showProse && conversation.length === 0 && !thinking && !error) return null;

  return (
    <div ref={history} role="log" aria-live="polite" aria-busy={thinking}
      className="max-h-[45vh] space-y-4 overflow-y-auto px-3 py-4 [overflow-wrap:anywhere] sm:px-4"
      data-testid="list-diary-conversation">
      {showProse && (
        <div className="ml-auto max-w-[92%] whitespace-pre-wrap break-words rounded-xl bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground sm:max-w-[85%]" data-testid="text-entry-prose">
          {priorProse}
        </div>
      )}
      {conversation.map((m) => (
        <div
          key={m.id}
          data-testid={`message-${m.role}-${m.id}`}
          className={`max-w-[92%] break-words rounded-xl px-4 py-3 text-sm leading-relaxed sm:max-w-[85%] ${
            m.role === "user"
              ? m.kind === "question"
                ? "ml-auto border border-primary/40 bg-primary/10 text-foreground"
                : "ml-auto bg-primary text-primary-foreground"
              : "mr-auto border border-card-border bg-card"
          }`}
        >
          {m.role === "assistant" ? (
            <>
              <div className="mb-2 text-[10px] uppercase tracking-widest text-primary">Living Diary</div>
              <RichMessageContent content={m.content} />
            </>
          ) : (
            <>
              {m.kind === "question" && (
                <div className="mb-1 text-[10px] uppercase tracking-widest text-primary">Question about entries</div>
              )}
              <div className="whitespace-pre-wrap">{m.content}</div>
            </>
          )}
        </div>
      ))}
      {thinking && (
        <div className="mr-auto flex items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="status-diary-thinking">
          <Loader2 className="h-4 w-4 animate-spin" />
          Living Diary is thinking...
        </div>
      )}
      {error && !thinking && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="status-diary-error">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error} Your writing is kept in this entry.</span>
          <Button type="button" size="sm" variant="outline" onClick={onRetry} className="gap-1.5" data-testid="button-retry-diary">
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}
    </div>
  );
}
