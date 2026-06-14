import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileText, RefreshCw } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Landing() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="Goal Tracker" className="h-8 w-8" />
          <div className="font-serif text-2xl tracking-tight text-foreground">Goal Tracker</div>
          <div className="flex-1" />
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            honest follow-through
          </div>
          <h1 className="font-serif text-5xl md:text-6xl text-foreground mt-4 leading-tight">
            The goals you keep,
            <br />
            measured honestly.
          </h1>
          <p className="text-lg text-muted-foreground mt-6 max-w-2xl mx-auto">
            A calendar-style tracker for daily habits, medium-term targets, and the long view.
            Sign in to sync across every device — and let the Assistant read your own notes.
          </p>
          <div className="flex items-center justify-center gap-3 mt-10">
            <Link href="/sign-up">
              <Button size="lg" className="gap-2">Create your account</Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline">Sign in</Button>
            </Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 pb-24 grid gap-8 md:grid-cols-3">
          <Feature
            icon={CheckCircle2}
            title="Track what counts"
            body="Daily, medium, and long-term goals on one honest timeline. No vanity metrics."
          />
          <Feature
            icon={RefreshCw}
            title="Synced everywhere"
            body="Your goals follow you across devices, tied securely to your account."
          />
          <Feature
            icon={FileText}
            title="Assistant reads your docs"
            body="Upload notes, plans, or research and the Assistant references them in chat."
          />
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-6 text-sm text-muted-foreground">
          Goal Tracker — honest follow-through.
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CheckCircle2;
  title: string;
  body: string;
}) {
  return (
    <div className="text-left">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="font-serif text-xl text-foreground mt-4">{title}</h3>
      <p className="text-muted-foreground mt-2">{body}</p>
    </div>
  );
}
