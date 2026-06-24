"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/providers", label: "Providers" },
  { href: "/dashboard/requests", label: "Requests" },
  { href: "/dashboard/guardrails", label: "Guardrails" },
  { href: "/dashboard/cache", label: "Cache" },
  { href: "/dashboard/tiers", label: "Model Tiers" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      <p className="px-3 pb-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
        PromptGate
      </p>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
