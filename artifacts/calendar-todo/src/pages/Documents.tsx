import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  listDocuments,
  registerDocument,
  deleteDocument,
  requestUploadUrl,
} from "@workspace/api-client-react";
import type { DocumentMeta } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FileText, Trash2, Upload } from "lucide-react";

const ACCEPT = ".txt,.md,.pdf,.doc,.docx";
const MAX_SIZE = 20 * 1024 * 1024;

function prettySize(bytes: number | undefined): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await listDocuments();
      setDocs(res.documents ?? []);
    } catch {
      setError("Couldn't load your documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_SIZE) {
          setError(`"${file.name}" is larger than 20 MB.`);
          continue;
        }
        const contentType = file.type || "application/octet-stream";
        const { uploadURL, objectPath } = await requestUploadUrl({
          name: file.name,
          size: file.size,
          contentType,
        });
        const put = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await registerDocument({
          name: file.name,
          contentType,
          size: file.size,
          objectPath,
        });
      }
      await refresh();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError("Couldn't delete that document.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Documents</div>
        <h1 className="font-serif text-3xl text-foreground">Reference material</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Upload notes, plans, or research as TXT, Markdown, Word, or PDF. The Assistant reads
          them and can reference their contents when you chat.
        </p>
      </header>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="gap-2"
        >
          {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Uploading…" : "Upload document"}
        </Button>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
      </div>

      <section>
        {loading ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Spinner className="h-4 w-4" /> Loading documents…
          </div>
        ) : docs.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-10 text-center text-muted-foreground">
            No documents yet. Upload one to give the Assistant something to read.
          </div>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-4 px-5 py-4 bg-card">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate">{doc.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {prettySize(doc.size)}
                    {doc.size ? " · " : ""}
                    {doc.createdAt ? format(new Date(doc.createdAt), "MMM d, yyyy") : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  aria-label={`Delete ${doc.name}`}
                >
                  {deletingId === doc.id ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
