import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send, Trash2, Bot, User, Loader2, Info, X,
} from "lucide-react";
import { useStore } from "@/lib/storage";
import { buildAssistantContext } from "@/lib/assistantContext";
import type { PsychAnalysis } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface MessageRow {
  id: string;
  userId: string;
  role: string;
  content: string;
  createdAt: string;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data as T;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDate(messages: MessageRow[]): { date: string; messages: MessageRow[] }[] {
  const groups = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const key = formatDate(m.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return [...groups.entries()].map(([date, messages]) => ({ date, messages }));
}

// Simple markdown-ish renderer: bold, bullet lists, numbered lists, paragraphs
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={j}>{p.slice(2, -2)}</strong>
        : p
    );
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#{1,3})/)?.[1].length ?? 1;
      const text = line.replace(/^#{1,3}\s/, "");
      const Tag = (`h${level + 2}`) as keyof JSX.IntrinsicElements;
      elements.push(<Tag key={i} className="font-semibold mt-3 mb-1 text-foreground">{renderInline(text)}</Tag>);
      i++;
    } else if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-0.5 my-1">
          {items.map((item, j) => <li key={j} className="text-sm leading-relaxed">{renderInline(item)}</li>)}
        </ul>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal list-inside space-y-0.5 my-1">
          {items.map((item, j) => <li key={j} className="text-sm leading-relaxed">{renderInline(item)}</li>)}
        </ol>
      );
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
      i++;
    }
  }

  return <div className="space-y-1">{elements}</div>;
}

const ANALYSIS_KEY = "goal-tracker:psych-analysis";

function loadAnalysis(): PsychAnalysis | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    return raw ? (JSON.parse(raw) as PsychAnalysis) : null;
  } catch {
    return null;
  }
}

export default function Informed() {
  const qc = useQueryClient();
  const { tasks, completions, journal } = useStore();
  const context = useMemo(
    () => buildAssistantContext(tasks, completions, journal, loadAnalysis()),
    [tasks, completions, journal],
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: messages = [], isLoading } = useQuery<MessageRow[]>({
    queryKey: ["informed-messages"],
    queryFn: () => apiFetch<MessageRow[]>("/api/informed/messages"),
    refetchOnWindowFocus: false,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/informed/messages", { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["informed-messages"] });
      setClearOpen(false);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setStreamingContent("");
    setStreamError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/informed/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text, context }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6)) as { content?: string; done?: boolean; error?: string };
            if (json.error) { setStreamError(json.error); break; }
            if (json.content) setStreamingContent((prev) => prev + json.content);
            if (json.done) {
              setStreamingContent("");
              void qc.invalidateQueries({ queryKey: ["informed-messages"] });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setStreamError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }, [input, streaming, qc]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const groups = groupByDate(messages);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 180px)", minHeight: "500px" }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/10 p-2.5">
            <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2">
              Informed
              <span className="text-xs font-normal bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                Claude
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Knows your goals, projects, follow-through rates, and documents
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="What does Claude know?"
          >
            <Info className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setClearOpen(true)}
            disabled={messages.length === 0}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="mt-3 shrink-0 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4 text-sm relative">
          <button
            type="button"
            onClick={() => setShowInfo(false)}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="font-medium text-violet-800 dark:text-violet-300 mb-2">What Claude knows about you</div>
          <ul className="space-y-1 text-muted-foreground">
            <li>• All your goals and how reliably you follow through on each one</li>
            <li>• Your follow-through rates by category and timeframe</li>
            <li>• Your personal reflections and journal entries</li>
            <li>• Your psychological profile (if generated)</li>
            <li>• All your projects — names, descriptions, recent conversations, and documents</li>
            <li>• All documents you've uploaded to the app</li>
          </ul>
          <div className="mt-2 text-xs text-muted-foreground">Context is refreshed with every message you send.</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1 min-h-0">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Spinner className="h-5 w-5" />
          </div>
        )}

        {!isLoading && messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 text-muted-foreground pb-8">
            <div className="rounded-2xl bg-violet-500/10 p-5">
              <Bot className="h-10 w-10 text-violet-500" />
            </div>
            <div className="max-w-sm">
              <div className="font-semibold text-foreground text-lg mb-2">Ask me anything</div>
              <div className="text-sm leading-relaxed">
                I know your goals, projects, and follow-through history. Ask for advice, a plan for today,
                feedback on a project, or just chat.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-md w-full mt-2">
              {[
                "What should I focus on today?",
                "What does my follow-through say about me?",
                "Give me honest feedback on my projects.",
                "Where am I most likely to fail?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}
                  className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-left hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {groups.map(({ date, messages: dayMsgs }) => (
          <div key={date}>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{date}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-4">
              {dayMsgs.map((m) => (
                <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="rounded-full bg-violet-500/10 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${m.role === "user" ? "" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      }`}
                    >
                      {m.role === "assistant"
                        ? <MessageContent content={m.content} />
                        : <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                      }
                    </div>
                    <div className={`text-[10px] text-muted-foreground mt-1 ${m.role === "user" ? "text-right" : "text-left"}`}>
                      {formatTime(m.createdAt)}
                    </div>
                  </div>
                  {m.role === "user" && (
                    <div className="rounded-full bg-secondary h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                      <User className="h-4 w-4 text-secondary-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Streaming in-progress */}
        {streaming && (
          <div className="flex gap-3 justify-start mt-4">
            <div className="rounded-full bg-violet-500/10 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
              <Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="max-w-[80%]">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                {streamingContent
                  ? <MessageContent content={streamingContent} />
                  : (
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  )
                }
              </div>
            </div>
          </div>
        )}

        {streamError && (
          <div className="text-sm text-destructive text-center py-2">{streamError}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 pt-3 border-t border-border">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude anything — it knows your full context… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder:text-muted-foreground"
          />
          <Button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || streaming}
            className="px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white h-full"
          >
            {streaming
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </Button>
        </div>
        <div className="text-xs text-muted-foreground mt-1.5 text-center">
          Powered by Claude · Context refreshed every message
        </div>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all messages in this conversation. Claude will start fresh next time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
