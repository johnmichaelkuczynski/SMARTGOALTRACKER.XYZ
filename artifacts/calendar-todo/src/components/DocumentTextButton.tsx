import { useRef, useState, type ReactElement } from "react";
import { FileText, Loader2 } from "lucide-react";
import { requestUploadUrl, extractDocumentText } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called with the text read out of the document once extraction succeeds. */
  onText: (text: string) => void;
  /** Button label. Pass "" to render an icon-only button. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

const ACCEPT = ".txt,.md,.pdf,.doc,.docx";
const MAX_SIZE = 20 * 1024 * 1024;

/**
 * Attach a report or document (TXT, Markdown, Word, PDF) to any text field. The file is
 * uploaded to object storage, the server reads its text, and that text is handed back via
 * onText so the caller can drop it into the box — useful for adding a report as context.
 */
export function DocumentTextButton({
  onText,
  label = "Add document",
  className,
  disabled,
}: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showError(message: string) {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 5000);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    if (file.size > MAX_SIZE) {
      showError("That file is larger than 20 MB.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const contentType = file.type || "application/octet-stream";
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: file.name || "document",
        size: file.size,
        contentType,
      });
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const { text } = await extractDocumentText({
        objectPath,
        name: file.name || "document",
        contentType,
      });
      const trimmed = text.trim();
      if (!trimmed) {
        showError("No readable text found in that file.");
        return;
      }
      onText(trimmed);
    } catch {
      showError("Couldn't read that file. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label="Attach a report or document and read its text in"
        title="Attach a report or document (TXT, Word, PDF) — its text is read in automatically"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        {label ? <span className="ml-1.5">{busy ? "Reading…" : label}</span> : null}
      </Button>
      {error && (
        <span className="absolute left-0 top-full z-20 mt-1 max-w-[16rem] whitespace-normal rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-md">
          {error}
        </span>
      )}
    </span>
  );
}
