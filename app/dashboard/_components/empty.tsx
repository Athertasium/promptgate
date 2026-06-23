export function Empty({ message = "No data yet" }: { message?: string }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-600">
      {message}
    </div>
  );
}
