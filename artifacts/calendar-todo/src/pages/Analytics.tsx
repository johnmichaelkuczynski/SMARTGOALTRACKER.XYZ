import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/storage";
import { computeAnalytics } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { resetSeed, clearAll } from "@/lib/storage";

export default function Analytics() {
  const { tasks, completions } = useStore();
  const a = computeAnalytics(tasks, completions);

  const timeframeData = [
    { name: "Daily", rate: Math.round(a.byTimeframe.daily.rate * 100), due: a.byTimeframe.daily.due, done: a.byTimeframe.daily.done },
    { name: "Medium", rate: Math.round(a.byTimeframe.medium.rate * 100), due: a.byTimeframe.medium.due, done: a.byTimeframe.medium.done },
    { name: "Long", rate: Math.round(a.byTimeframe.long.rate * 100), due: a.byTimeframe.long.due, done: a.byTimeframe.long.done },
  ];

  const importanceData = a.byImportance.map(({ importance, stats }) => ({
    name: `${importance}`,
    rate: Math.round(stats.rate * 100),
    due: stats.due,
    done: stats.done,
  }));

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Analytics</div>
          <h1 className="font-serif text-3xl text-foreground">The honest numbers</h1>
          <p className="text-muted-foreground mt-1">No spin. Just what you said versus what you did.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Replace everything with fresh sample data?")) resetSeed();
            }}
          >
            Reset to sample
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Erase all tasks and completions?")) clearAll();
            }}
          >
            Clear all
          </Button>
        </div>
      </header>

      <section>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <BigStat label="Overall" value={a.overall.rate} due={a.overall.due} done={a.overall.done} primary />
          <BigStat label="Daily" value={a.byTimeframe.daily.rate} due={a.byTimeframe.daily.due} done={a.byTimeframe.daily.done} />
          <BigStat label="Medium" value={a.byTimeframe.medium.rate} due={a.byTimeframe.medium.due} done={a.byTimeframe.medium.done} />
          <BigStat label="Long" value={a.byTimeframe.long.rate} due={a.byTimeframe.long.due} done={a.byTimeframe.long.done} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">By time frame</h2>
        <ChartCard data={timeframeData} />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">By importance</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Only tasks where you set an importance level. Tells you whether what you said mattered actually got done.
        </p>
        <ChartCard data={importanceData} xLabel="Importance" />
      </section>
    </div>
  );
}

function BigStat({
  label,
  value,
  due,
  done,
  primary,
}: {
  label: string;
  value: number;
  due: number;
  done: number;
  primary?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <div
      className={`rounded-xl border p-5 ${
        primary ? "bg-primary text-primary-foreground border-primary" : "bg-card border-card-border"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-widest ${primary ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className="font-mono text-4xl mt-2 tabular-nums">{due ? `${pct}%` : "—"}</div>
      <div className={`text-xs mt-1 ${primary ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
        {due ? `${done} of ${due} completed` : "No tracked occurrences yet"}
      </div>
    </div>
  );
}

function ChartCard({ data, xLabel }: { data: { name: string; rate: number; due: number; done: number }[]; xLabel?: string }) {
  const empty = data.every((d) => d.due === 0);
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div style={{ width: "100%", height: 280 }}>
        {empty ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
            Not enough data yet.
          </div>
        ) : (
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                label={xLabel ? { value: xLabel, position: "insideBottom", offset: -5, fill: "hsl(var(--muted-foreground))", fontSize: 11 } : undefined}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, _name, item) => {
                  const p = item.payload as { due: number; done: number };
                  return [`${value}% — ${p.done}/${p.due}`, "Completion"];
                }}
              />
              <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
                {data.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.due === 0 ? "hsl(var(--muted))" : "hsl(var(--primary))"}
                    fillOpacity={d.due === 0 ? 0.3 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
