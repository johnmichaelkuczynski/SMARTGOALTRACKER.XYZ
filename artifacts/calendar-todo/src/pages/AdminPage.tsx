import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AdminData = {
  stats: {
    allTime: number;
    last24Hours: number;
    lastWeek: number;
    lastMonth: number;
    lastYear: number;
  };
  series: {
    last24Hours: { label: string; count: number }[];
    lastWeek: { label: string; count: number }[];
    lastMonth: { label: string; count: number }[];
    lastYear: { label: string; count: number }[];
    allTime: { label: string; count: number }[];
  };
  visits: { id: number; email: string | null; visitedAt: string }[];
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-1">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-serif text-3xl text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">
        {value === 1 ? "login" : "logins"}
      </div>
    </div>
  );
}

function LoginChart({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 4, left: -24 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            cursor={{ fill: "hsl(var(--muted))" }}
          />
          <Bar
            dataKey="count"
            name="Logins"
            fill="hsl(var(--primary))"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AdminPage() {
  const { data, isLoading, error } = useQuery<AdminData>({
    queryKey: ["admin-visits"],
    queryFn: async () => {
      const res = await fetch("/api/admin/visits");
      if (res.status === 403) throw new Error("Access denied — admin only");
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json() as Promise<AdminData>;
    },
    staleTime: 30_000,
    retry: false,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-destructive text-sm">
        {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Administrative
        </div>
        <h1 className="font-serif text-3xl text-foreground">User analytics</h1>
        <p className="text-muted-foreground mt-1">
          Google sign-in history and login statistics.
        </p>
      </header>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Login counts
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Last 24 hours" value={data.stats.last24Hours} />
          <StatCard label="Last 7 days" value={data.stats.lastWeek} />
          <StatCard label="Last 30 days" value={data.stats.lastMonth} />
          <StatCard label="Last year" value={data.stats.lastYear} />
          <StatCard label="All time" value={data.stats.allTime} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Login graphs
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LoginChart
            title="Last 24 hours — by hour"
            data={data.series.last24Hours}
          />
          <LoginChart
            title="Last 7 days — by day"
            data={data.series.lastWeek ?? []}
          />
          <LoginChart
            title="Last 30 days — by day"
            data={data.series.lastMonth}
          />
          <LoginChart
            title="Last 12 months — by month"
            data={data.series.lastYear}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-baseline justify-between">
          <div className="font-medium text-foreground">Login history</div>
          <div className="text-xs text-muted-foreground">
            {data.visits.length} record{data.visits.length !== 1 ? "s" : ""}
          </div>
        </div>
        {data.visits.length === 0 ? (
          <div className="px-5 py-10 text-center text-muted-foreground text-sm">
            No logins recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[...data.visits].reverse().map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="text-sm font-medium text-foreground">
                  {v.email ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(v.visitedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
