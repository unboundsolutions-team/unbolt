"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * Admin navigation.
 *
 * Unlike the portal nav there is no permission filtering: /admin is already
 * gated wholesale by `requireInternal`, and hiding sections from staff who can
 * reach them anyway would only make the product harder to learn.
 */
const ITEMS = [
  { href: "/admin", label: "Queue" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/team", label: "Team" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto [contain:paint]">
        {ITEMS.map((item) => {
          // Exact match for the index, prefix match for the rest, so a detail
          // page keeps its section highlighted.
          const active =
            item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block whitespace-nowrap border-b-2 px-4 py-3",
                  "font-mono text-xs uppercase tracking-[0.14em]",
                  "transition-colors duration-(--duration-fast)",
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
