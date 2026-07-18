import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send, Trash2, Bot, User, Loader2, Info, X, Copy, Check,
  Plus, MessageSquare, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useStore, deviceId } from "@/lib/storage";
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface MessageRow {
  id: string;
  userId: string;
  conversationId: string | null;
  role: string;
  content: string;
  createdAt: string;
}

// ── Auth-aware fetch ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${deviceId}`,
      ...(opts?.headers ?? {}),
    },
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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

function relativeDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

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
    if (line.trim() === "") { i++; continue; }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#{1,3})/)?.[1].length ?? 1;
      const text = line.replace(/^#{1,3}\s/, "");
      const Tag = (`h${level + 2}`) as keyof JSX.IntrinsicElements;
      elements.push(<Tag key={i} className="font-semibold mt-3 mb-1">{renderInline(text)}</Tag>);
      i++;
    } else if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s/, "")); i++; }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-0.5 my-1">
          {items.map((item, j) => <li key={j} className="text-sm leading-relaxed">{renderInline(item)}</li>)}
        </ul>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, "")); i++; }
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

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text, light }: { text: string; light?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className={`shrink-0 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 ${
        light
          ? "text-white/60 hover:text-white hover:bg-white/20"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── PsychAnalysis local storage ───────────────────────────────────────────────

const ANALYSIS_KEY = "goal-tracker:psych-analysis";
function loadAnalysis(): PsychAnalysis | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    return raw ? (JSON.parse(raw) as PsychAnalysis) : null;
  } catch { return null; }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Informed() {
  const qc = useQueryClient();
  const { tasks, completions, journal } = useStore();
  const context = useMemo(
    () => buildAssistantContext(tasks, completions, journal, loadAnalysis()),
    [tasks, completions, journal],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Conversations list ──────────────────────────────────────────────────────

  const { data: conversations = [], isLoading: convsLoading } = useQuery<ConversationRow[]>({
    queryKey: ["informed-conversations"],
    queryFn: () => apiFetch<ConversationRow[]>("/api/informed/conversations"),
    refetchOnWindowFocus: false,
  });

  // Auto-select most recent conversation on first load
  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  const createConversation = useMutation({
    mutationFn: () => apiFetch<ConversationRow>("/api/informed/conversations", { method: "POST" }),
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["informed-conversations"] });
      setActiveId(conv.id);
      setInput("");
      setStreamError(null);
      setStreamingContent("");
      textareaRef.current?.focus();
    },
  });

  const deleteConversation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/api/informed/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["informed-conversations"] });
      void qc.invalidateQueries({ queryKey: ["informed-messages", deletedId] });
      if (activeId === deletedId) {
        // Switch to next available or null
        const remaining = conversations.filter((c) => c.id !== deletedId);
        setActiveId(remaining.length > 0 ? remaining[0].id : null);
      }
      setDeleteTarget(null);
    },
  });

  // ── Messages for active conversation ───────────────────────────────────────

  const { data: messages = [], isLoading: msgsLoading } = useQuery<MessageRow[]>({
    queryKey: ["informed-messages", activeId],
    queryFn: () =>
      activeId
        ? apiFetch<MessageRow[]>(`/api/informed/conversations/${activeId}/messages`)
        : Promise.resolve([]),
    enabled: !!activeId,
    refetchOnWindowFocus: false,
  });

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // Create a new conversation if none active
    let convId = activeId;
    if (!convId) {
      try {
        const conv = await apiFetch<ConversationRow>("/api/informed/conversations", { method: "POST" });
        await qc.invalidateQueries({ queryKey: ["informed-conversations"] });
        convId = conv.id;
        setActiveId(conv.id);
      } catch {
        setStreamError("Failed to create conversation.");
        return;
      }
    }

    setInput("");
    setStreaming(true);
    setStreamingContent("");
    setStreamError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/informed/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deviceId}`,
        },
        credentials: "include",
        body: JSON.stringify({ message: text, conversationId: convId, context }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let isFirst = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6)) as { content?: string; done?: boolean; error?: string; isFirstMessage?: boolean };
            if (json.error) { setStreamError(json.error); break; }
            if (json.content) setStreamingContent((prev) => prev + json.content);
            if (json.done) {
              isFirst = json.isFirstMessage ?? false;
              setStreamingContent("");
              void qc.invalidateQueries({ queryKey: ["informed-messages", convId] });
              if (isFirst) void qc.invalidateQueries({ queryKey: ["informed-conversations"] });
            }
          } catch { /* ignore */ }
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
  }, [input, streaming, activeId, context, qc]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const groups = groupByDate(messages);
  const activeConv = conversations.find((c) => c.id === activeId);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-0" style={{ height: "calc(100vh - 180px)", minHeight: "500px" }}>

      {/* ── Sidebar ── */}
      <div className={`flex flex-col shrink-0 border-r border-border transition-all duration-200 ${sidebarOpen ? "w-56" : "w-0 overflow-hidden"}`}>
        <div className="flex items-center justify-between px-3 pt-1 pb-2 shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chats</span>
          <button
            type="button"
            onClick={() => createConversation.mutate()}
            disabled={createConversation.isPending}
            title="New chat"
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {createConversation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Plus className="h-4 w-4" />
            }
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-0.5 px-1 min-h-0">
          {convsLoading && (
            <div className="flex justify-center py-4"><Spinner className="h-4 w-4" /></div>
          )}
          {!convsLoading && conversations.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 px-2">
              No chats yet. Start a new one.
            </div>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${
                conv.id === activeId
                  ? "bg-violet-100 dark:bg-violet-900/30 text-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => { setActiveId(conv.id); setStreamError(null); }}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{conv.title}</div>
                <div className="text-[10px] opacity-50">{relativeDateLabel(conv.updatedAt)}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv.id); }}
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                title="Delete chat"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Chat header */}
        <div className="flex items-center justify-between pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div className="rounded-xl bg-violet-500/10 p-2">
              <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="font-semibold flex items-center gap-2 text-sm">
                {activeConv ? activeConv.title : "Informed"}
                <span className="text-xs font-normal bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">Claude</span>
              </div>
              <div className="text-xs text-muted-foreground">Knows your goals, projects, follow-through rates, and documents</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => createConversation.mutate()}
              disabled={createConversation.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
            <button
              type="button"
              onClick={() => setShowInfo(!showInfo)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="What does Claude know?"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Info panel */}
        {showInfo && (
          <div className="mt-2 shrink-0 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-3 text-sm relative">
            <button type="button" onClick={() => setShowInfo(false)} className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
            <div className="font-medium text-violet-800 dark:text-violet-300 mb-1.5 text-xs uppercase tracking-wide">What Claude knows</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• All your goals and follow-through rates (by category and timeframe)</li>
              <li>• Your personal reflections and journal entries</li>
              <li>• Your psychological profile (if generated)</li>
              <li>• All your projects — names, descriptions, recent conversations, and documents</li>
              <li>• All documents you've uploaded to the app</li>
            </ul>
            <div className="mt-1.5 text-[10px] text-muted-foreground">Context is refreshed with every message.</div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1 min-h-0">
          {(msgsLoading) && (
            <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div>
          )}

          {!msgsLoading && !activeId && !streaming && (
            <EmptyState
              onStarterClick={(p) => { setInput(p); textareaRef.current?.focus(); }}
              onNewChat={() => createConversation.mutate()}
            />
          )}

          {!msgsLoading && activeId && messages.length === 0 && !streaming && (
            <EmptyState
              onStarterClick={(p) => { setInput(p); textareaRef.current?.focus(); }}
              onNewChat={() => createConversation.mutate()}
            />
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
                    <div className="max-w-[80%] group">
                      <div className={`relative rounded-2xl px-4 py-3 ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md selection:bg-white/30 selection:text-white"
                          : "bg-muted text-foreground rounded-bl-md"
                      }`}>
                        {m.role === "user" && (
                          <div className="absolute -top-2 -left-8 flex">
                            <CopyButton text={m.content} light />
                          </div>
                        )}
                        {m.role === "assistant" && (
                          <div className="absolute -top-2 -right-8 flex">
                            <CopyButton text={m.content} />
                          </div>
                        )}
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

          {/* Streaming */}
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
              placeholder={activeId ? "Message Claude… (Enter to send)" : "Start a new message… (Enter to send)"}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || streaming}
              className="px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white h-full"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-1.5 text-center">
            Powered by Claude · Context refreshed every message
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages in this conversation will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteConversation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConversation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onStarterClick, onNewChat }: { onStarterClick: (p: string) => void; onNewChat: () => void }) {
  return (
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-md w-full mt-1">
        {[
          "What should I focus on today?",
          "What does my follow-through say about me?",
          "Give me honest feedback on my projects.",
          "Where am I most likely to fail?",
        ].map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onStarterClick(prompt)}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-left hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
