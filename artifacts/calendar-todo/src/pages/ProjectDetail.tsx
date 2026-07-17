import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, Send, Plus, Trash2, Brain, BarChart2,
  FileText, MessageSquare, Settings, Pencil, Check, X,
  Bot, User, Loader2, RefreshCw, FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
interface MessageRow {
  id: string;
  projectId: string;
  role: string;
  content: string;
  createdAt: string;
}
interface DocumentRow {
  id: string;
  projectId: string;
  name: string;
  contentType: string;
  content: string;
  createdAt: string;
}
interface ProjectData {
  project: ProjectRow;
  messages: MessageRow[];
  documents: DocumentRow[];
}
interface Analytics {
  totalMessages: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  recentActiveDays: number;
  firstActivity: string | null;
  lastActivity: string | null;
  chartData: { label: string; count: number }[];
  weekData: { label: string; count: number }[];
}

type Tab = "chat" | "documents" | "analytics" | "profile" | "settings";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("chat");

  const { data, isLoading, error } = useQuery<ProjectData>({
    queryKey: ["project", id],
    queryFn: () => apiFetch<ProjectData>(`/api/projects/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
        <Spinner className="h-5 w-5" /> Loading project…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="py-16 text-center">
        <div className="text-muted-foreground mb-3">Project not found or failed to load.</div>
        <Link href="/projects">
          <Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to projects</Button>
        </Link>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "chat",      label: "Chat",      icon: <MessageSquare className="h-4 w-4" /> },
    { key: "documents", label: "Documents", icon: <FileText className="h-4 w-4" /> },
    { key: "analytics", label: "Analytics", icon: <BarChart2 className="h-4 w-4" /> },
    { key: "profile",   label: "Profile Me",icon: <Brain className="h-4 w-4" /> },
    { key: "settings",  label: "Settings",  icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/projects">
          <button type="button" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </Link>
        <div className="rounded-lg bg-primary/10 p-2">
          <FolderOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{data.project.name}</h1>
          {data.project.description && (
            <p className="text-sm text-muted-foreground truncate">{data.project.description}</p>
          )}
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex gap-0 -mb-px overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {tab === "chat"      && <ChatTab projectId={id!} initialMessages={data.messages} />}
        {tab === "documents" && <DocumentsTab projectId={id!} initialDocs={data.documents} />}
        {tab === "analytics" && <AnalyticsTab projectId={id!} />}
        {tab === "profile"   && <ProfileTab projectId={id!} />}
        {tab === "settings"  && <SettingsTab project={data.project} />}
      </div>
    </div>
  );
}

// ── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ projectId, initialMessages }: { projectId: string; initialMessages: MessageRow[] }) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ userMessage: MessageRow; assistantMessage: MessageRow }>(
        `/api/projects/${projectId}/chat`,
        { method: "POST", body: JSON.stringify({ message: text }) },
      );
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed. Try again.");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 340px)", minHeight: "400px" }}>
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <div className="rounded-full bg-muted p-4">
              <MessageSquare className="h-8 w-8" />
            </div>
            <div>
              <div className="font-medium text-foreground">Start the conversation</div>
              <div className="text-sm mt-1 max-w-sm">
                Tell the advisor what you're trying to achieve, where you're stuck, or ask for strategic advice.
              </div>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="rounded-full bg-primary/10 p-2 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted text-foreground rounded-bl-md"
              }`}
            >
              {m.content}
            </div>
            {m.role === "user" && (
              <div className="rounded-full bg-secondary p-2 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                <User className="h-4 w-4 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-3 justify-start">
            <div className="rounded-full bg-primary/10 p-2 h-8 w-8 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive text-center py-1">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 pt-3 border-t border-border">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the project advisor… (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || sending} className="h-full px-4 rounded-xl">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ projectId, initialDocs }: { projectId: string; initialDocs: DocumentRow[] }) {
  const qc = useQueryClient();
  const [docs, setDocs] = useState<DocumentRow[]>(initialDocs);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: { name: string; content: string }) =>
      apiFetch<DocumentRow>(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (doc) => {
      setDocs((prev) => [doc, ...prev]);
      setAddOpen(false);
      setDocName("");
      setDocContent("");
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: (_, docId) => {
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      setDeleteId(null);
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Project documents</h2>
          <p className="text-sm text-muted-foreground">Notes, research, plans, or any text the AI advisor should know about.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> Add document
        </Button>
      </div>

      {docs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="rounded-full bg-muted p-4">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">No documents yet</div>
            <div className="text-sm text-muted-foreground mt-1">
              Add research notes, a business plan, a chapter draft — anything the advisor should reference.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm flex-1 truncate">{d.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(d.createdAt)}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDeleteId(d.id); }}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {expandedId === d.id && (
              <div className="px-4 pb-4 border-t border-border">
                <pre className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
                  {d.content || "(no content)"}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) { setSaveError(null); setDocName(""); setDocContent(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Document name</Label>
              <Input
                id="doc-name"
                placeholder="e.g. Business model, Chapter 1, Research notes…"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-content">Content</Label>
              <Textarea
                id="doc-content"
                placeholder="Paste or type the document content here. The AI advisor will read this when responding."
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{docContent.length.toLocaleString()} characters</p>
            </div>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => { setSaveError(null); addMutation.mutate({ name: docName.trim(), content: docContent.trim() }); }}
              disabled={!docName.trim() || !docContent.trim() || addMutation.isPending}
            >
              {addMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Save document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the document from this project.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error, refetch } = useQuery<Analytics>({
    queryKey: ["project-analytics", projectId],
    queryFn: () => apiFetch<Analytics>(`/api/projects/${projectId}/analytics`),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>;
  if (error || !data) return (
    <div className="text-center py-12 text-muted-foreground">
      <p>Couldn't load analytics.</p>
      <Button variant="ghost" size="sm" className="mt-3 gap-2" onClick={() => refetch()}>
        <RefreshCw className="h-4 w-4" /> Try again
      </Button>
    </div>
  );

  const maxCount = Math.max(...data.chartData.map((d) => d.count), 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total messages" value={data.totalMessages} />
        <StatCard label="Active days" value={data.activeDays} />
        <StatCard label="Current streak" value={`${data.currentStreak}d`} />
        <StatCard label="Longest streak" value={`${data.longestStreak}d`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-medium mb-1">First activity</div>
          <div className="text-2xl font-mono">{formatDate(data.firstActivity)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-medium mb-1">Last activity</div>
          <div className="text-2xl font-mono">{formatDate(data.lastActivity)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Messages per day — last 30 days</h3>
        {data.totalMessages === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">No messages yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.chartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                interval={4}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                cursor={{ fill: "hsl(var(--muted))" }}
              />
              <Bar dataKey="count" name="Messages" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Messages per week — last 12 weeks</h3>
        {data.totalMessages === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">No messages yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.weekData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                cursor={{ fill: "hsl(var(--muted))" }}
              />
              <Bar dataKey="count" name="Messages" fill="hsl(var(--primary)/0.7)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="text-3xl font-mono font-semibold">{value}</div>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({ projectId }: { projectId: string }) {
  const [profile, setProfile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ profile: string }>(`/api/projects/${projectId}/profile`, { method: "POST" });
      setProfile(res.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-semibold text-lg">Profile Me</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A psychological profile of you specifically in relation to this project — your drive, follow-through patterns,
          decision-making style, risk profile, and blocking behaviours. Generated fresh from your conversation history.
        </p>
      </div>

      {!profile && !loading && (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <Brain className="h-8 w-8 text-primary" />
          </div>
          <div>
            <div className="font-medium">Ready to generate your profile</div>
            <div className="text-sm text-muted-foreground mt-1 max-w-sm">
              The AI will analyse your full conversation history to build a detailed psychological profile.
              You need at least 3 messages in the chat first.
            </div>
          </div>
          <Button onClick={generate} className="gap-2">
            <Brain className="h-4 w-4" /> Generate profile
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-sm text-muted-foreground">Analysing your conversations… this takes a moment.</div>
        </div>
      )}

      {profile && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {profile.split("\n").map((line, i) => {
                if (line.startsWith("**") && line.endsWith("**")) {
                  return <h3 key={i} className="font-semibold text-foreground mt-4 first:mt-0">{line.replace(/\*\*/g, "")}</h3>;
                }
                if (line.match(/^\*\*\d+\./)) {
                  const clean = line.replace(/\*\*/g, "");
                  return <h3 key={i} className="font-semibold text-foreground mt-5 first:mt-0">{clean}</h3>;
                }
                if (line.trim() === "") return <div key={i} className="h-2" />;
                return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{line}</p>;
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={generate} variant="outline" className="gap-2" disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Regenerate
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ project }: { project: ProjectRow }) {
  const [, navigate] = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiFetch<ProjectRow>(`/api/projects/${project.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["project", project.id] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/api/projects/${project.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      window.location.href = "/projects";
    },
  });

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="font-semibold text-lg">Project settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Update the name and description, or delete the project.</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="s-name">Project name</Label>
          <Input
            id="s-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-desc">Description</Label>
          <Textarea
            id="s-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <Button
          onClick={() => updateMutation.mutate({ name: name.trim(), description: description.trim() })}
          disabled={!name.trim() || updateMutation.isPending}
          className="gap-2"
        >
          {updateMutation.isPending ? <Spinner className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {saved ? "Saved" : "Save changes"}
        </Button>
        {updateMutation.isError && (
          <p className="text-sm text-destructive">{updateMutation.error?.message}</p>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="font-medium text-destructive mb-2">Danger zone</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Deleting this project is permanent and removes all messages and documents.
        </p>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Delete project</Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages and documents in this project will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
