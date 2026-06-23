import { Nav } from "./_components/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="w-52 shrink-0 border-r border-zinc-800">
        <Nav />
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
