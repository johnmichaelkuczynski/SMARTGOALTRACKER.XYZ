import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Check, X, Trophy } from "lucide-react";
import { deviceId } from "@/lib/storage";

// ── API helpers ───────────────────────────────────────────────────────────────

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceId}`,
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

interface Accomplishment {
  id: string;
  text: string;
  date: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function groupByDate(items: Accomplishment[]): { date: string; rows: Accomplishment[] }[] {
  const map = new Map<string, Accomplishment[]>();
  for (const item of items) {
    const existing = map.get(item.date) ?? [];
    existing.push(item);
    map.set(item.date, existing);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => ({ date, rows }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Accomplishments() {
  const qc = useQueryClient();
  const [inputText, setInputText] = useState("");
  const [inputDate, setInputDate] = useState(todayStr());
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery<{ accomplishments: Accomplishment[] }>({
    queryKey: ["accomplishments"],
    queryFn: () => apiFetch("/api/accomplishments"),
    refetchOnWindowFocus: false,
  });

  const accomplishments = data?.accomplishments ?? [];
  const groups = groupByDate(accomplishments);

  const add = useMutation({
    mutationFn: (vars: { text: string; date: string }) =>
      apiFetch<Accomplishment>("/api/accomplishments", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      setInputText("");
      setInputDate(todayStr());
      void qc.invalidateQueries({ queryKey: ["accomplishments"] });
      textareaRef.current?.focus();
    },
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; text: string; date: string }) =>
      apiFetch<Accomplishment>(`/api/accomplishments/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text: vars.text, date: vars.date }),
      }),
    onSuccess: () => {
      setEditId(null);
      void qc.invalidateQueries({ queryKey: ["accomplishments"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/accomplishments/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["accomplishments"] }),
  });

  function handleAdd() {
    const t = inputText.trim();
    if (!t) return;
    add.mutate({ text: t, date: inputDate });
  }

  function startEdit(a: Accomplishment) {
    setEditId(a.id);
    setEditText(a.text);
    setEditDate(a.date);
    setTimeout(() => editRef.current?.focus(), 50);
  }

  function commitEdit() {
    if (!editId) return;
    const t = editText.trim();
    if (!t) return;
    update.mutate({ id: editId, text: t, date: editDate });
  }

  function cancelEdit() {
    setEditId(null);
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Record</div>
        <h1 className="font-serif text-3xl text-foreground flex items-baseline gap-3">
          Accomplishments
        </h1>
        <p className="text-muted-foreground mt-1">
          What you actually did — planned or not. Each entry is date-stamped.
        </p>
      </header>

      {/* Add form */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">Add an accomplishment</span>
        </div>
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="What did you accomplish? (Enter to save, Shift+Enter for newline)"
          rows={3}
          className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Date</label>
            <input
              type="date"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inputText.trim() || add.isPending}
            className="ml-auto flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {add.isPending ? "Saving…" : "Add"}
          </button>
        </div>
        {add.isError && (
          <p className="text-xs text-destructive">{add.error.message}</p>
        )}
      </div>

      {/* List */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && accomplishments.length === 0 && (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <Trophy className="h-10 w-10 mx-auto opacity-20" />
          <p className="text-sm">No accomplishments yet. Add your first one above.</p>
        </div>
      )}

      {groups.map(({ date, rows }) => (
        <section key={date} className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground whitespace-nowrap">
              {formatDate(date)}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <ul className="space-y-2">
            {rows.map((a) => (
              <li
                key={a.id}
                className="group rounded-2xl border border-border bg-card px-5 py-4 shadow-sm transition-shadow hover:shadow-md"
              >
                {editId === a.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editRef}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                        if (e.key === "Escape") cancelEdit();
                      }}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                        <button
                          type="button"
                          onClick={commitEdit}
                          disabled={!editText.trim() || update.isPending}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500 mt-2" />
                    <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap">{a.text}</p>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(a.id)}
                        disabled={remove.isPending}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
