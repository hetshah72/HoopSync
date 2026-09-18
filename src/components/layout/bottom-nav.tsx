"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * The phone tab bar. Hidden from `lg` up, where `SideNav` takes over.
 *
 * A floating bar rather than a full-width band welded to the bottom edge: the
 * gap underneath lets the ambient canvas show through on all four sides, so it
 * reads as a control surface hovering over the content - and it keeps the tap
 * targets clear of the iOS home indicator, which `pb-safe` pads for.
 *
 * The active tab is marked three ways over a single-channel highlight: an
 * ember tint, a heavier icon, and a weight change. Colour alone would fail
 * anyone who can't distinguish it.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-3">
        <ul className="glass pointer-events-auto grid grid-cols-6 gap-0.5 rounded-2xl p-1.5 shadow-lg ring-1 ring-foreground/10">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "press relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[0.6875rem] leading-none font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-brand-soft font-semibold text-brand-soft-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[1.125rem] transition-transform duration-200",
                      active && "scale-110",
                    )}
                    strokeWidth={active ? 2.4 : 2}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
