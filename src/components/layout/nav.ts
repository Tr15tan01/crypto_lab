import {
  LayoutDashboard,
  ScanSearch,
  Telescope,
  BookOpen,
  Star,
  Wallet,
  Sparkles,
  NotebookPen,
  ChartNoAxesCombined,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/market", label: "Market Scanner", icon: ScanSearch, match: ["/crypto"] },
  { href: "/discover", label: "Discovery", icon: Telescope },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/research", label: "AI Research", icon: Sparkles },
  { href: "/journal", label: "Decision Journal", icon: NotebookPen },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { href: "/guide", label: "Guide", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];
