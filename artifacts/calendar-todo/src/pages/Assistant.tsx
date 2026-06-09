import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Loader2, Sparkles, Trash2 } from "lucide-react";
import {
  useChatAssistant,
  type PsychAnalysis,
  type PsychChatMessage,
} from "@workspace/api-client-react";
import { useStore } from "@/lib/storage";
import { buildAssistantContext } from "@/lib/assistantContext";
import { Button } from "@/components/ui/button";

const CHAT_KEY = "tally:assistant-chat:v1";
const ANALYSIS_KEY = "tally:psych:v1";

function loadChat(): PsychChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as PsychChatMessage[]) : [];
  } catch {
    return [];
  }
}

function loadAnalysis(): PsychAnalysis | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    return raw ? (JSON.parse(raw) as PsychAnalysis) : null;
  } catch {
    return null;
  }
}

const SUGGESTIONS = [
  "Given my track record, what should I focus on today?",
  "What kind of person do my goals and follow-through say I am?",
  "Which goals am I most likely to drop, and why?",
  "Should I take on a new daily habit right now?",
];

export default function Assistant() {
  const { tasks, completions, journal } = useStore();
  const [chat, setChat] = useState<PsychChatMessage[]>(() => loadChat());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sendChat = useChatAssistant();
  const scrollRef = useRef<HTMLDivElement>(null);

  const context = useMemo(
    () => buildAssistantContext(tasks, completions, journal, loadAnalysis()),
    [tasks, completions, journal],
  );

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  }, [chat]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, sendChat.isPending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendChat.isPending) return;
    setError(null);
    const next = [...chat, { role: "user", content: trimmed }];
    setChat(next);
    setInput("");
    try {
      const result = await sendChat.mutateAsync({ data: { messages: next, context } });
      setChat([...next, { role: "assistant", content: result.reply }]);
    } catch {
      setChat(next);
      setError("Couldn't get a reply. Try again.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Assistant</div>
          <h1 className="font-serif text-3xl text-foreground">Talk to your tracker</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            A full assistant that also knows your schedule, what you've completed, your analytics, and
            the kinds of goals you actually follow through on. Ask it anything.
          </p>
        </div>
        {chat.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChat([])}
            className="shrink-0 text-muted-foreground"
          >
            <Trash2 className="size-4" /> Clear
          </Button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card flex flex-col">
        <div ref={scrollRef} className="max-h-[520px] min-h-[320px] overflow-y-auto p-5 space-y-4">
          {chat.length === 0 && !sendChat.isPending ? (
            <div className="py-8 text-center">
              <Sparkles className="size-7 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-3 mb-5 max-w-md mx-auto">
                I can see your whole tracker. Ask me what to do, what your patterns say about you, or
                anything else.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-card-border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover-elevate text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sendChat.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted text-muted-foreground rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>
        <form onSubmit={submit} className="border-t border-card-border p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || sendChat.isPending}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
