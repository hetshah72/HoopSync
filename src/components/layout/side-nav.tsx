"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * The desktop navigation rail.
 *
 * On a wide screen a bottom tab bar is the wrong control - it strands the
 * primary navigation at the far edge of a 27" display and wastes the entire
 * left margin. This rail is the same six destinations from `NAV_ITEMS`, given
 * the room to carry a label *and* a hint, which is space a phone never has.
 *
 * Only the links are a Client Component; the brand lockup and the account
 * footer around it stay on the server (see the app shell), so the sign-out
 * Server Action doesn't have to cross a client boundary.
 */
export function SideNavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex-1 px-3 py-4">
      <ul className="space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, hint }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-brand-soft text-brand-soft-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {/* The active marker is a shape, not just a colour, so the
                    current destination survives a colour-vision difference. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 -left-3 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className="size-[1.15rem] shrink-0"
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm leading-tight",
                      active ? "font-semibold" : "font-medium",
                    )}
                  >
                    {label}
                  </span>
                  {/* Supplementary only - hidden from the accessibility tree
                      so each link's accessible name stays exactly its label
                      ("Players", not "Players Study the pros"). */}
                  <span
                    aria-hidden
                    className="block truncate text-[0.6875rem] leading-tight text-muted-foreground/80"
                  >
                    {hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
