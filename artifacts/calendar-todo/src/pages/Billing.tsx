import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/useAuth";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type BillingStatus = {
  configured: boolean;
  status: string;
  active: boolean;
  customerExists: boolean;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

async function billingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Billing request failed");
  return body as T;
}

export default function Billing() {
  const { data: auth } = useAuth();
  const queryClient = useQueryClient();
  const identity = `u:${auth?.user?.id ?? "loading"}`;
  const query = useQuery<BillingStatus>({
    queryKey: ["billing-status", identity],
    queryFn: () => billingFetch("/api/billing/status"),
    enabled: Boolean(auth?.user),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const checkout = useMutation({
    mutationFn: () =>
      billingFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ returnPath: `${basePath}/billing` }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const portal = useMutation({
    mutationFn: () =>
      billingFetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({ returnPath: `${basePath}/billing` }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const status = query.data;
  const pending = checkout.isPending || portal.isPending;
  const error = checkout.error || portal.error || query.error;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Account</div>
        <h1 className="font-serif text-3xl text-foreground">Billing</h1>
        <p className="mt-1 text-muted-foreground">
          Start or manage your Goal Tracker subscription securely through Stripe.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        {query.isLoading ? (
          <div className="flex items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading billing status…
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                {status?.active ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <CreditCard className="h-6 w-6" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">
                  {status?.active ? "Subscription active" : "Goal Tracker subscription"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {status?.active
                    ? status.cancelAtPeriodEnd
                      ? "Your subscription remains active until the end of the current billing period."
                      : "Your subscription is active and renews automatically."
                    : "Subscribe through Stripe’s secure checkout to activate your plan."}
                </p>
                {status?.currentPeriodEnd && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Current period ends{" "}
                    {new Date(status.currentPeriodEnd).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error.message}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {status?.active ? (
                <Button
                  onClick={() => portal.mutate()}
                  disabled={pending}
                  className="gap-2"
                >
                  {portal.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Manage billing
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => checkout.mutate()}
                    disabled={pending}
                    className="gap-2"
                  >
                    {checkout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Subscribe securely
                  </Button>
                  {status?.customerExists && (
                    <Button
                      variant="outline"
                      onClick={() => portal.mutate()}
                      disabled={pending}
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Manage billing
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ["billing-status"] })
                }
                disabled={query.isFetching}
              >
                Refresh status
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4" />
        Payment details are entered and stored by Stripe, not Goal Tracker.
      </div>
    </div>
  );
}