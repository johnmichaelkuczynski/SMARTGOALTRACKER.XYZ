import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Check, X, Lightbulb, Search, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/useAuth";

// ── API helpers ───────────────────────────────────────────────────────────────

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Tip {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Tips() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const { data: auth } = useAuth();
  const identity = `u:${auth?.user?.id ?? "loading"}`;

  const { data, isLoading } = useQuery<{ tips: Tip[] }>({
    queryKey: ["tips", identity],
    queryFn: () => apiFetch("/api/tips"),
    enabled: Boolean(auth?.user),
    refetchOnWindowFocus: false,
  });

  const tips = data?.tips ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? tips.filter((t) => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
    : tips;

  const add = useMutation({
    mutationFn: (vars: { title: string; body: string }) =>
      apiFetch<Tip>("/api/tips", { method: "POST", body: JSON.stringify(vars) }),
    onSuccess: (row) => {
      setNewTitle("");
      setNewBody("");
      setShowAdd(false);
      setExpanded((prev) => new Set(prev).add(row.id));
      void qc.invalidateQueries({ queryKey: ["tips"] });
    },
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; title: string; body: string }) =>
      apiFetch<Tip>(`/api/tips/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: vars.title, body: vars.body }),
      }),
    onSuccess: () => {
      setEditId(null);
      void qc.invalidateQueries({ queryKey: ["tips"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/api/tips/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tips"] }),
  });

  function handleAdd() {
    const t = newTitle.trim();
    const b = newBody.trim();
    if (!t || !b) return;
    add.mutate({ title: t, body: b });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEdit(tip: Tip) {
    setEditId(tip.id);
    setEditTitle(tip.title);
    setEditBody(tip.body);
  }

  function commitEdit() {
    if (!editId) return;
    const t = editTitle.trim();
    const b = editBody.trim();
    if (!t || !b) return;
    update.mutate({ id: editId, title: t, body: b });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Reference</div>
        <h1 className="font-serif text-3xl text-foreground">Tips</h1>
        <p className="text-muted-foreground mt-1">
          A place to keep useful instructions and how-tos — like getting a website indexed by Google.
        </p>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tips…"
            className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAdd((v) => !v);
            setTimeout(() => titleRef.current?.focus(), 50);
          }}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
        >
          <Plus className="h-4 w-4" /> New tip
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">New tip</span>
          </div>
          <input
            ref={titleRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title — e.g. Getting a website indexed by Google"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="The instructions or notes…"
            rows={6}
            className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newTitle.trim() || !newBody.trim() || add.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {add.isPending ? "Saving…" : "Save tip"}
            </button>
          </div>
          {add.isError && <p className="text-xs text-destructive">{add.error.message}</p>}
        </div>
      )}

      {/* List */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && tips.length === 0 && (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <Lightbulb className="h-10 w-10 mx-auto opacity-20" />
          <p className="text-sm">No tips yet. Save your first one with "New tip".</p>
        </div>
      )}

      {!isLoading && tips.length > 0 && filtered.length === 0 && (
        <p className="text-center py-8 text-sm text-muted-foreground">No tips match "{search}".</p>
      )}

      <ul className="space-y-2">
        {filtered.map((tip) => {
          const isOpen = expanded.has(tip.id) || Boolean(q);
          const isEditing = editId === tip.id;
          return (
            <li
              key={tip.id}
              className="group rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              {isEditing ? (
                <div className="p-5 space-y-3">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditId(null);
                    }}
                    rows={8}
                    className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={commitEdit}
                      disabled={!editTitle.trim() || !editBody.trim() || update.isPending}
                      className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(tip.id)}
                      className="flex flex-1 items-center gap-2 text-left min-w-0"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium truncate">{tip.title}</span>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(tip)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(tip.id)}
                        disabled={remove.isPending}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <p className="mt-3 pl-6 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                      {tip.body}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
