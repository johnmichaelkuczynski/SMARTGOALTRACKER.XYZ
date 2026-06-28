import { useRef, useState, type ReactElement } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { requestUploadUrl, extractImageText } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called with the text read out of the image once OCR succeeds. */
  onText: (text: string) => void;
  /** Button label. Pass "" to render an icon-only button. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Attach a screenshot or photo to any text field. The image is uploaded to object
 * storage, the server reads its text (OCR), and that text is handed back via onText
 * so the caller can drop it into the box — useful as proof of achievement.
 */
export function ImageOcrButton({ onText, label = "Add image", className, disabled }: Props): ReactElement {
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
    if (!file.type.startsWith("image/")) {
      showError("That's not an image. Pick a screenshot or photo.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const contentType = file.type || "image/png";
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: file.name || "screenshot.png",
        size: file.size,
        contentType,
      });
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const { text } = await extractImageText({ objectPath });
      const trimmed = text.trim();
      if (!trimmed) {
        showError("No readable text found in that image.");
        return;
      }
      onText(trimmed);
    } catch {
      showError("Couldn't read that image. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label="Attach a screenshot or photo and read its text in"
        title="Attach a screenshot or photo — its text is read in automatically"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
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
