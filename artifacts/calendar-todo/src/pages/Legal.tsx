import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send, Trash2, Bot, User, Loader2, X, Copy, Check,
  Plus, MessageSquare, ChevronLeft, ChevronRight, ImageIcon, Paperclip,
  FileText, Square, Download, CornerDownRight, Mic, MicOff, Scale, FolderOpen,
  Brain, ChevronDown, ChevronUp, Wrench,
} from "lucide-react";
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
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageRow {
  id: string;
  userId: string;
  conversationId: string | null;
  role: string;
  content: string;
  imageData?: string | null;
  imageMediaType?: string | null;
  attachments?: string | null;
  createdAt: string;
}

interface StoredAttachment {
  type: "image" | "document";
  name: string;
  mediaType: string;
  data?: string;
}

interface LegalDocumentRow {
  id: string;
  conversationId: string | null;
  name: string;
  contentType: string;
  size: number;
  charCount: number | null;
  createdAt: string;
}

interface Attachment {
  localId: string;
  type: "image" | "document";
  name: string;
  sizeLabel: string;
  data?: string;
  mediaType?: string;
  preview?: string;
  text?: string;
}

// ── Auth-aware fetch ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Image helpers ─────────────────────────────────────────────────────────────

const MAX_DIM = 1536;
const JPEG_QUALITY = 0.85;

function compressImage(file: Blob): Promise<{ data: string; mediaType: string; preview: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1];
      resolve({ data: base64, mediaType: "image/jpeg", preview: dataUrl });
    };
    img.onerror = reject;
    img.src = url;
  });
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
      const Tag = `h${level + 2}` as React.ElementType;
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Legal() {
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [expandedTiers, setExpandedTiers] = useState<Record<number, boolean>>({});

  // ── Response preferences ─────────────────────────────────────────────────────
  type RespLength = "natural" | "extremely_concise" | "concise" | "normal" | "thorough" | "extremely_thorough";
  type RespFormat = "natural" | "sentences" | "bullets" | "numbered";
  type RespTone   = "strongly_critical" | "critical" | "neutral" | "mildly_positive" | "positive";
  const [respLength, setRespLength] = useState<RespLength>("natural");
  const [respFormat, setRespFormat] = useState<RespFormat>("natural");
  const [respTone,   setRespTone]   = useState<RespTone>("neutral");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const isDictatingRef = useRef(false);

  // ── Conversations list ──────────────────────────────────────────────────────

  const { data: conversations = [], isLoading: convsLoading } = useQuery<ConversationRow[]>({
    queryKey: ["legal-conversations"],
    queryFn: () => apiFetch<ConversationRow[]>("/api/legal/conversations"),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  const createConversation = useMutation({
    mutationFn: (parentId?: string) => apiFetch<ConversationRow>("/api/legal/conversations", {
      method: "POST",
      body: JSON.stringify(parentId ? { parentId } : {}),
    }),
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["legal-conversations"] });
      setActiveId(conv.id);
      setInput("");
      setPendingAttachments([]);
      setStreamError(null);
      setStreamingContent("");
      textareaRef.current?.focus();
    },
  });

  const deleteConversation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/api/legal/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["legal-conversations"] });
      void qc.invalidateQueries({ queryKey: ["legal-messages", deletedId] });
      if (activeId === deletedId) {
        const remaining = conversations.filter((c) => c.id !== deletedId);
        setActiveId(remaining.length > 0 ? remaining[0].id : null);
      }
      setDeleteTarget(null);
    },
  });

  // ── Memory viewer ────────────────────────────────────────────────────────────

  interface MemoryNode { k: string; tag: string; text: string; }
  interface MemoryTierView { tier: number; nodeCount: number; compressionCount: number; lastUpdate: string; nodes: MemoryNode[]; }

  const { data: memoryData, isLoading: memoryLoading, refetch: refetchMemory } = useQuery<{ tiers: MemoryTierView[] }>({
    queryKey: ["legal-memory"],
    queryFn: () => apiFetch<{ tiers: MemoryTierView[] }>("/api/legal/memory/view"),
    refetchOnWindowFocus: false,
    enabled: showMemory,
  });

  const repairMemory = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; tiersRepaired: number }>("/api/legal/memory/repair", { method: "POST" }),
    onSuccess: () => void refetchMemory(),
  });

  const TAG_COLORS: Record<string, string> = {
    REJECTS: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    CONFLICT_FLAG: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
    ENTITY: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    ASSERTS: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    KEY_TERM: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    OPEN: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    ASSUMES: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
    CROSS_REF: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300",
  };

  // ── All uploaded documents ──────────────────────────────────────────────────

  const { data: allDocs = [], isLoading: docsLoading, refetch: refetchDocs } = useQuery<LegalDocumentRow[]>({
    queryKey: ["legal-documents"],
    queryFn: () => apiFetch<{ documents: LegalDocumentRow[] }>("/api/legal/documents").then((r) => r.documents),
    refetchOnWindowFocus: false,
    enabled: showDocs,
  });

  // ── Messages for active conversation ───────────────────────────────────────

  const { data: messages = [], isLoading: msgsLoading } = useQuery<MessageRow[]>({
    queryKey: ["legal-messages", activeId],
    queryFn: () =>
      activeId
        ? apiFetch<MessageRow[]>(`/api/legal/conversations/${activeId}/messages`)
        : Promise.resolve([]),
    enabled: !!activeId,
    refetchOnWindowFocus: false,
  });

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── File handling ────────────────────────────────────────────────────────────

  const formatSize = (bytes: number) => bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const addImageFile = useCallback(async (file: File | Blob) => {
    const fileName = (file as File).name ?? "";
    const lowerName = fileName.toLowerCase();
    const isHeic = file.type === "image/heic" || file.type === "image/heif"
      || lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
    if (!file.type.startsWith("image/") && !isHeic) return;

    const localId = crypto.randomUUID();
    const name = fileName || "image.jpg";
    const sizeLabel = formatSize(file.size);

    if (isHeic) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const data = btoa(binary);
      setPendingAttachments((prev) => [...prev, { localId, type: "image", name, sizeLabel, data, mediaType: "image/heic", preview: undefined }]);
      textareaRef.current?.focus();
      return;
    }

    try {
      const img = await compressImage(file);
      setPendingAttachments((prev) => [...prev, { localId, type: "image", name, sizeLabel, data: img.data, mediaType: img.mediaType, preview: img.preview }]);
      textareaRef.current?.focus();
    } catch {
      setStreamError("Failed to process image.");
    }
  }, []);

  const addDocumentFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const isText = file.type === "text/plain" || name.endsWith(".txt");
    const isPdf  = file.type === "application/pdf" || name.endsWith(".pdf");
    const isDocx = file.type.includes("wordprocessingml") || name.endsWith(".docx");
    const isDoc  = file.type === "application/msword" || name.endsWith(".doc");
    if (!isText && !isPdf && !isDocx && !isDoc) return;

    const sizeLabel = formatSize(file.size);
    const localId = crypto.randomUUID();

    if (isText) {
      const text = await file.text();
      setPendingAttachments((prev) => [...prev, { localId, type: "document", name: file.name, mediaType: "text/plain", text, sizeLabel }]);
    } else {
      const mediaType = isPdf
        ? "application/pdf"
        : isDocx
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/msword";
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const data = btoa(binary);
      setPendingAttachments((prev) => [...prev, { localId, type: "document", name: file.name, mediaType, data, sizeLabel }]);
    }
    textareaRef.current?.focus();
  }, []);

  const handleAnyFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase();
    const isHeic = lower.endsWith(".heic") || lower.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif";
    if (file.type.startsWith("image/") || isHeic) void addImageFile(file);
    else void addDocumentFile(file);
  }, [addImageFile, addDocumentFile]);

  const removeAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.localId !== localId));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (items.length > 0) {
      e.preventDefault();
      for (const item of items) {
        const blob = item.getAsFile();
        if (blob) void addImageFile(blob);
      }
    }
  }, [addImageFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) handleAnyFile(file);
  }, [handleAnyFile]);

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || streaming) return;

    let convId = activeId;
    if (!convId) {
      try {
        const conv = await apiFetch<ConversationRow>("/api/legal/conversations", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await qc.invalidateQueries({ queryKey: ["legal-conversations"] });
        convId = conv.id;
        setActiveId(conv.id);
      } catch {
        setStreamError("Failed to create conversation.");
        return;
      }
    }

    setInput("");
    const sentAttachments = pendingAttachments;
    setPendingAttachments([]);
    setStreaming(true);
    setStreamingContent("");
    setStreamError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const images = sentAttachments
        .filter((a) => a.type === "image")
        .map((a) => ({ data: a.data!, mediaType: a.mediaType!, name: a.name }));
      const documents = sentAttachments
        .filter((a) => a.type === "document")
        .map((a) => ({ name: a.name, mediaType: a.mediaType!, text: a.text, data: a.data }));

      const body: Record<string, unknown> = {
        message: text,
        conversationId: convId,
        preferences: { length: respLength, format: respFormat, tone: respTone },
      };
      if (images.length) body.images = images;
      if (documents.length) body.documents = documents;

      const res = await fetch("/api/legal/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(body),
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
              void qc.invalidateQueries({ queryKey: ["legal-messages", convId] });
              if (isFirst) void qc.invalidateQueries({ queryKey: ["legal-conversations"] });
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
  }, [input, pendingAttachments, streaming, activeId, qc, respLength, respFormat, respTone]);

  // ── Dictation ────────────────────────────────────────────────────────────────

  const toggleDictation = useCallback(() => {
    if (isDictatingRef.current) {
      isDictatingRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsDictating(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStreamError("Speech recognition is not supported in this browser. Use Chrome or Edge.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SR() as any;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let baseText = "";
    setInput((prev) => { baseText = prev; return prev; });

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalChunk += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (finalChunk) {
        const trimmed = finalChunk.trim();
        baseText = baseText ? (baseText.trimEnd() + " " + trimmed) : trimmed;
      }
      const displayed = interim.trim()
        ? (baseText ? baseText.trimEnd() + " " + interim.trim() : interim.trim())
        : baseText;
      setInput(displayed);
    };

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setStreamError(`Dictation error: ${e.error}`);
      }
    };

    recognition.onend = () => {
      if (isDictatingRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    recognitionRef.current = recognition;
    isDictatingRef.current = true;
    setIsDictating(true);
    recognition.start();
  }, []);

  useEffect(() => {
    return () => {
      isDictatingRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const groups = groupByDate(messages);
  const activeConv = conversations.find((c) => c.id === activeId);
  const canSend = (!!input.trim() || pendingAttachments.length > 0) && !streaming;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex gap-0"
      style={{ height: "calc(100vh - 180px)", minHeight: "500px" }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif,.pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        className="hidden"
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) handleAnyFile(file);
          e.target.value = "";
        }}
      />

      {/* ── Memory viewer panel (right) ── */}
      {showMemory && (
        <div className="flex flex-col shrink-0 w-80 border-l border-border bg-background overflow-hidden order-last">
          <div className="flex items-center justify-between px-3 pt-2 pb-2 shrink-0 border-b border-border">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-semibold">Case Memory</span>
              {memoryData && (
                <span className="text-xs text-muted-foreground">
                  {memoryData.tiers.reduce((s, t) => s + t.nodeCount, 0)} nodes · {memoryData.tiers.length} tier{memoryData.tiers.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => repairMemory.mutate()}
                disabled={repairMemory.isPending}
                title="Force-compress all bloated tiers"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-violet-600 transition-colors"
              >
                {repairMemory.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => void refetchMemory()}
                title="Refresh"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
              >↻</button>
              <button
                type="button"
                onClick={() => setShowMemory(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-2">
            {memoryLoading && (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
            {!memoryLoading && (!memoryData || memoryData.tiers.length === 0) && (
              <div className="text-xs text-muted-foreground text-center py-8 px-3">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No memory yet. Start chatting and facts will accumulate here.
              </div>
            )}
            {memoryData && [...memoryData.tiers].sort((a, b) => b.tier - a.tier).map((t) => {
              const isExpanded = expandedTiers[t.tier] ?? true;
              const maxTier = Math.max(...memoryData.tiers.map((x) => x.tier));
              const label = t.tier === maxTier
                ? `Tier ${t.tier} — Foundation`
                : t.tier === 1
                ? "Tier 1 — Live"
                : `Tier ${t.tier} — Compressed`;
              const labelColor = t.tier === maxTier
                ? "text-violet-700 dark:text-violet-300"
                : t.tier === 1
                ? "text-green-700 dark:text-green-300"
                : "text-blue-700 dark:text-blue-300";
              return (
                <div key={t.tier} className="border border-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedTiers((prev) => ({ ...prev, [t.tier]: !isExpanded }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
                      <span className="text-[10px] text-muted-foreground">{t.nodeCount} nodes</span>
                      {t.compressionCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">· {t.compressionCount}x compressed</span>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border px-2 py-1.5 space-y-1 max-h-96 overflow-y-auto">
                      {t.nodes.map((node) => (
                        <div key={node.k} className="flex gap-1.5 items-start py-0.5">
                          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mt-0.5 ${TAG_COLORS[node.tag] ?? "bg-muted text-muted-foreground"}`}>
                            {node.tag.replace("_", " ")}
                          </span>
                          <span className="text-[11px] leading-relaxed text-foreground break-words min-w-0">{node.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {repairMemory.isSuccess && (
            <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-green-600 dark:text-green-400">
              ✓ Repaired {(repairMemory.data as { tiersRepaired: number }).tiersRepaired} tier(s)
            </div>
          )}
          {repairMemory.isError && (
            <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-destructive">
              Repair failed
            </div>
          )}
        </div>
      )}

      {/* ── Document vault panel (right) ── */}
      {showDocs && (
        <div className="flex flex-col shrink-0 w-72 border-l border-border bg-background overflow-hidden order-last">
          <div className="flex items-center justify-between px-3 pt-2 pb-2 shrink-0 border-b border-border">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold">Uploaded Files</span>
            </div>
            <button
              type="button"
              onClick={() => setShowDocs(false)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-1">
            {docsLoading && (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
            {!docsLoading && allDocs.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-8 px-3">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No documents uploaded yet.<br />Attach a PDF, Word doc, or TXT to any message.
              </div>
            )}
            {!docsLoading && allDocs.length > 0 && (() => {
              // Group by conversationId
              const convMap = new Map<string | null, LegalDocumentRow[]>();
              for (const doc of allDocs) {
                const key = doc.conversationId ?? "__none__";
                if (!convMap.has(key)) convMap.set(key, []);
                convMap.get(key)!.push(doc);
              }
              return Array.from(convMap.entries()).map(([convId, docs]) => {
                const convTitle = convId === "__none__"
                  ? "No conversation"
                  : (conversations.find((c) => c.id === convId)?.title ?? convId.slice(0, 8) + "…");
                const isActive = convId === activeId;
                return (
                  <div key={convId} className="mb-2">
                    <div
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-semibold cursor-pointer transition-colors ${
                        isActive
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => { if (convId !== "__none__") { setActiveId(convId); setShowDocs(false); } }}
                      title={convId !== "__none__" ? "Jump to this conversation" : undefined}
                    >
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      <span className="truncate">{convTitle}</span>
                    </div>
                    {docs.map((doc) => {
                      const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
                      const extColors: Record<string, string> = {
                        pdf: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
                        doc: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
                        docx: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
                        txt: "bg-muted text-muted-foreground",
                      };
                      const badge = extColors[ext] ?? "bg-muted text-muted-foreground";
                      const kbSize = doc.size ? (doc.size / 1024).toFixed(0) + " KB" : null;
                      const chars = doc.charCount ? doc.charCount.toLocaleString() + " chars" : null;
                      return (
                        <div
                          key={doc.id}
                          className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-muted transition-colors group"
                        >
                          <FileText className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium leading-tight truncate" title={doc.name}>{doc.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${badge}`}>{ext}</span>
                              {kbSize && <span className="text-[10px] text-muted-foreground">{kbSize}</span>}
                              {chars && <span className="text-[10px] text-muted-foreground">{chars}</span>}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(doc.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
            {allDocs.length} file{allDocs.length !== 1 ? "s" : ""} total
            {activeId && ` · ${allDocs.filter((d) => d.conversationId === activeId).length} in this chat`}
          </div>
        </div>
      )}

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
            <div className="text-xs text-muted-foreground text-center py-4 px-2">No chats yet.</div>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-1 rounded-lg py-1.5 cursor-pointer transition-colors ${
                conv.parentId ? "pl-4 pr-2" : "px-2"
              } ${
                conv.id === activeId
                  ? "bg-amber-100 dark:bg-amber-900/30 text-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => { setActiveId(conv.id); setStreamError(null); setPendingAttachments([]); }}
            >
              {conv.parentId
                ? <CornerDownRight className="h-3 w-3 shrink-0 opacity-40" />
                : <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
              }
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{conv.title}</div>
                <div className="text-[10px] opacity-50">{relativeDateLabel(conv.updatedAt)}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); createConversation.mutate(conv.id); }}
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-amber-600 transition-all"
                title="Follow-up chat"
              >
                <CornerDownRight className="h-3 w-3" />
              </button>
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
            <div className="rounded-xl bg-amber-500/10 p-2">
              <Scale className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="font-semibold flex items-center gap-2 text-sm">
                {activeConv ? activeConv.title : "Legal LLM"}
                <span className="text-xs font-normal bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">Claude</span>
              </div>
              <div className="text-xs text-muted-foreground">Rigorous legal analysis — documents, contracts, filings, rights</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setShowMemory((v) => !v); if (!showMemory) void refetchMemory(); }}
              title="View what the AI remembers about your case"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                showMemory
                  ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              Memory
              {memoryData && (
                <span className="ml-0.5 bg-violet-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {memoryData.tiers.reduce((s, t) => s + t.nodeCount, 0)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setShowDocs((v) => !v); if (!showDocs) void refetchDocs(); }}
              title="Show all uploaded documents"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                showDocs
                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Files
              {allDocs.length > 0 && (
                <span className="ml-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {allDocs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => createConversation.mutate(undefined)}
              disabled={createConversation.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Start a completely new chat"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
            {activeId && messages.length > 0 && (
              <button
                type="button"
                onClick={() => createConversation.mutate(activeId)}
                disabled={createConversation.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                title="Continue this conversation in a new chat"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                Follow-up
              </button>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                title="Download conversation"
                onClick={() => {
                  const convo = conversations.find((c) => c.id === activeId);
                  const title = convo?.title ?? "legal-chat";
                  const lines: string[] = [
                    title.toUpperCase(),
                    `Exported: ${new Date().toLocaleString()}`,
                    "=".repeat(60),
                    "",
                  ];
                  for (const m of messages) {
                    const speaker = m.role === "user" ? "YOU" : "CLAUDE";
                    const ts = new Date(m.createdAt).toLocaleString();
                    lines.push(`${speaker}  [${ts}]`);
                    lines.push("-".repeat(40));
                    const plain = m.content
                      .replace(/^#{1,6}\s+/gm, "")
                      .replace(/\*\*(.+?)\*\*/g, "$1")
                      .replace(/\*(.+?)\*/g, "$1")
                      .replace(/`(.+?)`/g, "$1")
                      .replace(/^\s*[-*]\s+/gm, "  - ");
                    lines.push(plain);
                    lines.push("");
                  }
                  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(a.href);
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1 min-h-0">
          {msgsLoading && (
            <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div>
          )}

          {!msgsLoading && !activeId && !streaming && (
            <LegalEmptyState
              onStarterClick={(p) => { setInput(p); textareaRef.current?.focus(); }}
              onNewChat={() => createConversation.mutate()}
            />
          )}

          {!msgsLoading && activeId && messages.length === 0 && !streaming && (
            <LegalEmptyState
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
                      <div className="rounded-full bg-amber-500/10 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                        <Scale className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
                            <CopyButton text={m.content === "[image]" ? "" : m.content} light />
                          </div>
                        )}
                        {m.role === "assistant" && (
                          <div className="absolute -top-2 -right-8 flex">
                            <CopyButton text={m.content} />
                          </div>
                        )}
                        {/* Attachments */}
                        {m.role === "user" && (() => {
                          let atts: StoredAttachment[] = [];
                          if (m.attachments) {
                            try { atts = JSON.parse(m.attachments) as StoredAttachment[]; } catch { /* ignore */ }
                          } else if (m.imageData && m.imageMediaType) {
                            atts = [{ type: "image", name: "image", mediaType: m.imageMediaType, data: m.imageData }];
                          }
                          const imgs = atts.filter((a) => a.type === "image" && a.data);
                          const docs = atts.filter((a) => a.type === "document");
                          return (
                            <>
                              {imgs.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-1.5">
                                  {imgs.map((img, i) => (
                                    <img
                                      key={i}
                                      src={`data:${img.mediaType};base64,${img.data}`}
                                      alt={img.name}
                                      className={`rounded-lg object-cover border border-white/20 ${imgs.length === 1 ? "max-h-64 max-w-full" : "h-28 w-28"}`}
                                    />
                                  ))}
                                </div>
                              )}
                              {docs.map((doc, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm opacity-90 mb-1">
                                  <FileText className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{doc.name}</span>
                                </div>
                              ))}
                            </>
                          );
                        })()}
                        {/* Text content */}
                        {m.role === "assistant"
                          ? <MessageContent content={m.content} />
                          : (() => {
                              const isBracket = m.content.startsWith("[") && m.content.endsWith("]");
                              if (isBracket) return null;
                              return <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>;
                            })()
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
              <div className="rounded-full bg-amber-500/10 h-8 w-8 flex items-center justify-center shrink-0 mt-1">
                <Scale className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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

        {/* Input area */}
        <div className="shrink-0 pt-3 border-t border-border">
          {/* Pending attachments tray */}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex items-start gap-2 flex-wrap">
              {pendingAttachments.map((att) =>
                att.type === "image" ? (
                  <div key={att.localId} className="relative inline-block shrink-0">
                    {att.preview ? (
                      <img src={att.preview} alt={att.name} className="rounded-xl h-20 w-20 object-cover border border-border" />
                    ) : (
                      <div className="rounded-xl h-20 w-20 border border-border bg-muted flex flex-col items-center justify-center gap-1">
                        <ImageIcon className="h-6 w-6 text-amber-400" />
                        <span className="text-[9px] text-muted-foreground text-center px-1 truncate max-w-full leading-tight">HEIC</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.localId)}
                      className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 text-muted-foreground hover:text-foreground shadow-sm"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div key={att.localId} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted relative shrink-0 max-w-[180px]">
                    <FileText className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{att.name}</div>
                      <div className="text-[10px] text-muted-foreground">{att.sizeLabel}</div>
                    </div>
                    <button type="button" onClick={() => removeAttachment(att.localId)} className="ml-1 text-muted-foreground hover:text-foreground shrink-0">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              )}
            </div>
          )}
          {/* ── Response preferences bar ── */}
          <div className="flex items-center gap-2 flex-wrap pb-1.5 border-b border-border/50 mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">Response:</span>
            <select
              value={respLength}
              onChange={(e) => setRespLength(e.target.value as RespLength)}
              title="Response length"
              className="text-xs rounded-lg border border-border bg-background px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer"
            >
              <option value="natural">Natural length</option>
              <option value="extremely_concise">Extremely concise</option>
              <option value="concise">Concise</option>
              <option value="normal">Normal</option>
              <option value="thorough">Thorough</option>
              <option value="extremely_thorough">Extremely thorough</option>
            </select>
            <select
              value={respFormat}
              onChange={(e) => setRespFormat(e.target.value as RespFormat)}
              title="Response format"
              className="text-xs rounded-lg border border-border bg-background px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer"
            >
              <option value="natural">Natural format</option>
              <option value="sentences">Full sentences</option>
              <option value="bullets">Bullet points</option>
              <option value="numbered">Numbered list</option>
            </select>
            <select
              value={respTone}
              onChange={(e) => setRespTone(e.target.value as RespTone)}
              title="Response tone"
              className="text-xs rounded-lg border border-border bg-background px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer"
            >
              <option value="strongly_critical">Strongly critical</option>
              <option value="critical">Critical</option>
              <option value="neutral">Neutral</option>
              <option value="mildly_positive">Mildly positive</option>
              <option value="positive">Positive</option>
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach images, PDFs, Word docs, or TXT"
              className="shrink-0 p-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              title={isDictating ? "Stop dictation" : "Dictate into chat"}
              className={`shrink-0 p-2.5 rounded-xl border transition-colors ${
                isDictating
                  ? "border-red-400 bg-red-50 dark:bg-red-950/30 text-red-500 animate-pulse"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {isDictating ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isDictating
                  ? "Listening… speak now"
                  : pendingAttachments.length > 0
                  ? "Add a message (optional)… or press Enter to send"
                  : "Ask a legal question… (Enter to send, Shift+Enter for newline)"
              }
              rows={2}
              className={`flex-1 resize-none rounded-xl border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 placeholder:text-muted-foreground transition-colors ${
                isDictating
                  ? "border-red-400 focus:ring-red-400/50"
                  : "border-border focus:ring-amber-500/50"
              }`}
            />
            {streaming ? (
              <Button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white shrink-0 h-[52px]"
                title="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!canSend}
                className="px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white shrink-0 h-[52px]"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5 text-center">
            Attach contracts, filings, images · Paste or drag-drop · Always consult a licensed attorney
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

function LegalEmptyState({ onStarterClick, onNewChat }: { onStarterClick: (p: string) => void; onNewChat: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 text-muted-foreground pb-8">
      <div className="rounded-2xl bg-amber-500/10 p-5">
        <Scale className="h-10 w-10 text-amber-500" />
      </div>
      <div className="max-w-sm">
        <div className="font-semibold text-foreground text-lg mb-2">Legal LLM</div>
        <div className="text-sm leading-relaxed">
          Rigorous legal analysis — documents, contracts, filings, rights, and procedures.
          Upload a PDF and ask whether it's valid. Paste a clause and ask what it means.
          Always verify with a licensed attorney.
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-md w-full mt-1">
        {[
          "Is this service of process valid?",
          "What are the defects in this contract?",
          "What does this clause actually mean?",
          "Is this filing procedurally correct?",
        ].map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onStarterClick(prompt)}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-left hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
        <Paperclip className="h-3.5 w-3.5" />
        <span>Attach PDFs, Word docs, or images of documents via the paperclip button</span>
      </div>
    </div>
  );
}
