"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import type { Permission } from "@/server/rbac";

/**
 * Portal navigation.
 *
 * Items are filtered by the capability set resolved on the server, so a member
 * never sees a Billing link that would only bounce them. This is presentation,
 * not security — the page itself still calls requirePermission. Hiding a link
 * is a courtesy; the guard is what stops the request.
 */
const ITEMS: { href: string; label: string; needs?: Permission }[] = [
  { href: "/app", label: "Overview" },
  { href: "/app/tasks", label: "Tasks", needs: "task:read" },
  { href: "/app/stores", label: "Stores", needs: "store:read" },
  { href: "/app/team", label: "Team", needs: "member:read" },
  { href: "/app/settings", label: "Settings", needs: "org:read" },
];

export function PortalNav({ permissions }: { permissions: readonly Permission[] }) {
  const pathname = usePathname();
  const allowed = ITEMS.filter((i) => !i.needs || permissions.includes(i.needs));

  return (
    <nav aria-label="Portal" className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto [contain:paint]">
        {allowed.map((item) => {
          const active = pathname === item.href;
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
