import {
  Dumbbell,
  Home,
  LineChart,
  MessageCircle,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

// Exact nav per docs/HoopSync_BRD_v1.1.md §4 - Goals lives inside Progress,
// not as its own tab. Don't add a 7th entry for Goals; add a tab/section on
// the Progress page instead.
//
// One list, two presentations: `SideNav` renders it as a rail on desktop and
// `BottomNav` as a tab bar on phones. Keeping the definition here is what
// guarantees the two can never drift out of sync.
export const NAV_ITEMS: readonly {
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  { href: "/home", label: "Home", icon: Home, hint: "Your feed" },
  { href: "/train", label: "Train", icon: Dumbbell, hint: "Workouts & drills" },
  { href: "/players", label: "Players", icon: Users, hint: "Study the pros" },
  { href: "/analyze", label: "Analyze", icon: LineChart, hint: "Shots & film" },
  { href: "/coach", label: "Coach", icon: MessageCircle, hint: "Ask anything" },
  {
    href: "/progress",
    label: "Progress",
    icon: TrendingUp,
    hint: "Stats & goals",
  },
] as const;
