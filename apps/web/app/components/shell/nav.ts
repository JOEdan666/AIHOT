// Site navigation, one place for the desktop sidebar, the mobile tab bar and the mobile "更多" page.
import { FEATURES } from "@aihot/industry/features";
import type { ReactNode } from "react";
import { IconBolt, IconBookmark, IconChart, IconDoc, IconGrid, IconHeart, IconHistory, IconList } from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

export const SIDEBAR: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "每周看一眼",
    items: [
      { to: "/", label: "本周", icon: IconBolt, end: true },
      { to: "/topics", label: "主题", icon: IconGrid },
      { to: "/monthly", label: "月报", icon: IconDoc },
    ],
  },
  {
    title: "我的",
    items: [{ to: "/admin/desk", label: "灵感", icon: IconBookmark }],
  },
  // The optional AI-only modules (industry/features.ts).
  ...(FEATURES.leaderboard || FEATURES.codexResetMonitor
    ? [
        {
          title: "模型",
          items: [
            ...(FEATURES.leaderboard ? [{ to: "/leaderboard", label: "模型榜", icon: IconChart }] : []),
            ...(FEATURES.codexResetMonitor ? [{ to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory }] : []),
          ],
        },
      ]
    : []),
  {
    title: "更多",
    items: [
      { to: "/all", label: "全部动态", icon: IconList },
      { to: "/about", label: "关于", icon: IconHeart },
    ],
  },
];

// Two places to be: this week's reading, and the notebook.
export const TABBAR: NavItem[] = [
  { to: "/", label: "本周", icon: IconBolt, end: true },
  { to: "/admin/desk", label: "灵感", icon: IconBookmark },
];

export function tabIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/monthly") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
