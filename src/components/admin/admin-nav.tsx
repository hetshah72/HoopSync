"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Cpu, LayoutDashboard, Library, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The admin dashboard's own navigation - BRD 6.2's areas, one tab each.
 *
 * Separate from `NAV_ITEMS`, which is the player navigation and is frozen at
 * six by BRD v1.1 §4. Nothing here may leak into that list.
 */
const ADMIN_TABS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/players", label: "Players", icon: Users },
  { href: "/admin/content", label: "Content", icon: Boxes },
  { href: "/admin/library", label: "Library", icon: Library },
  { href: "/admin/ai", label: "AI", icon: Cpu },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections">
      <ul className="flex flex-wrap gap-1.5">
        {ADMIN_TABS.map(({ href, label, icon: Icon, ...rest }) => {
          // "/admin" would otherwise match every child route and light up on
          // all four tabs at once.
          const exact = "exact" in rest && rest.exact;
          const active = exact ? pathname === href : pathname.startsWith(href);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-brand-soft font-semibold text-brand-soft-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
