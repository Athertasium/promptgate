interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "indigo" | "default";
}

export function StatCard({ label, value, sub, accent = "default" }: StatCardProps) {
  const accentClass = {
    green: "text-emerald-400",
    red: "text-rose-400",
    indigo: "text-indigo-400",
    default: "text-zinc-100",
  }[accent];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
