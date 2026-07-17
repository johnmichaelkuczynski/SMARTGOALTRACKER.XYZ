import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, FolderOpen, Trash2, ArrowRight, MessageSquare, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
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
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProjectsList() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: projects = [], isLoading, error } = useQuery<ProjectRow[]>({
    queryKey: ["projects"],
    queryFn: () => apiFetch<ProjectRow[]>("/api/projects"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiFetch<ProjectRow>("/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setCreateOpen(false);
      setName("");
      setDescription("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setDeleteId(null);
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), description: description.trim() });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Long-term projects with AI dialogue, document storage, analytics, and psychological profiling.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Spinner className="h-5 w-5" /> Loading…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn't load projects. Try refreshing.
        </div>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="rounded-full bg-muted p-4">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium text-foreground">No projects yet</div>
            <div className="text-sm text-muted-foreground mt-1">
              Create your first project — a business idea, novel, career move, anything long-term.
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> Create a project
          </Button>
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <Link href={`/projects/${p.id}`} className="block p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                      <FolderOpen className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="font-semibold text-foreground truncate">{p.name}</h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {p.description}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> Chat
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Docs
                  </span>
                  <span className="ml-auto">Updated {timeAgo(p.updatedAt)}</span>
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setDeleteId(p.id); }}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                aria-label="Delete project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="proj-name">Name</Label>
              <Input
                id="proj-name"
                placeholder="e.g. Monetize apps, Write novel, Launch startup…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="proj-desc"
                placeholder="What is this project about? What are you trying to achieve?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
                Create project
              </Button>
            </DialogFooter>
            {createMutation.isError && (
              <p className="text-sm text-destructive">{createMutation.error?.message}</p>
            )}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the project along with all its messages and documents. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
