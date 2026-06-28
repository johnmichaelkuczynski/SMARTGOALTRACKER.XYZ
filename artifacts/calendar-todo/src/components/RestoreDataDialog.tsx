import { useRef, useState } from "react";
import { Download, Upload, ClipboardCopy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { exportState, importState } from "@/lib/storage";

const EXPORT_SNIPPET = `(function(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&(k==='tally:v1'||k.indexOf('tally:v1:')===0))o[k]=localStorage.getItem(k);}var b=new Blob([JSON.stringify(o)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='goal-tracker-backup.json';document.body.appendChild(a);a.click();a.remove();})();`;

type Status = { kind: "idle" | "success" | "error"; message?: string };

export function RestoreDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  function apply(text: string) {
    const result = importState(text);
    if (result.ok) {
      setStatus({
        kind: "success",
        message: `Restored ${result.score} item${result.score === 1 ? "" : "s"}. Saving to your database\u2026`,
      });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => apply(String(reader.result ?? ""));
    reader.onerror = () =>
      setStatus({ kind: "error", message: "Couldn't read that file. Try again." });
    reader.readAsText(file);
    e.target.value = "";
  }

  function onExport() {
    const blob = new Blob([exportState()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "goal-tracker-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(EXPORT_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Restore your data</DialogTitle>
          <DialogDescription>
            Bring tasks, rules, and journal entries in from a backup file or from
            another copy of the app. Restored data is saved to your account database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <section className="space-y-3">
            <div className="text-sm font-medium text-foreground">
              1. Get a backup from your other app
            </div>
            <p className="text-sm text-muted-foreground">
              Open the copy of the app that still has your data in a normal browser
              tab. Press <kbd className="px-1 rounded bg-muted">F12</kbd> to open
              developer tools, click <strong>Console</strong>, paste the code below,
              and press <kbd className="px-1 rounded bg-muted">Enter</kbd>. A file
              called <code>goal-tracker-backup.json</code> will download.
            </p>
            <div className="relative">
              <pre className="text-[11px] leading-snug bg-muted rounded-md p-3 pr-10 overflow-x-auto whitespace-pre-wrap break-all">
                {EXPORT_SNIPPET}
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1.5 right-1.5 h-7 w-7"
                onClick={copySnippet}
                aria-label="Copy code"
              >
                {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-medium text-foreground">
              2. Load the backup here
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onFile}
            />
            <Button type="button" onClick={() => fileRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" /> Choose backup file
            </Button>
            <div className="text-xs text-muted-foreground">
              Or paste the backup contents directly:
            </div>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder='{"tasks":[...]}'
              className="font-mono text-xs h-24"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!pasted.trim()}
              onClick={() => apply(pasted)}
            >
              Restore from pasted text
            </Button>
          </section>

          {status.kind !== "idle" && (
            <div
              className={`text-sm rounded-md p-3 ${
                status.kind === "success"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {status.message}
            </div>
          )}

          <section className="border-t border-border pt-4 space-y-2">
            <div className="text-sm font-medium text-foreground">Back up this app</div>
            <p className="text-sm text-muted-foreground">
              Download a copy of your current data to keep it safe.
            </p>
            <Button type="button" variant="outline" className="gap-2" onClick={onExport}>
              <Download className="h-4 w-4" /> Download backup
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
