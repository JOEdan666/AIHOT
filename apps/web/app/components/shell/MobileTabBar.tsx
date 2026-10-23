import { Link, useLocation } from "react-router";
import { TABBAR, tabIsActive } from "./nav";

/** Floating glass bar at the bottom of the phone shell (up to 960px): this week, and the notebook. */
export function MobileTabBar(_props: { changelogVersion: string | null }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="底部导航" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(10px+env(safe-area-inset-bottom))] lg:hidden">
      <div className="glass pointer-events-auto grid h-[58px] w-[min(260px,calc(100%-48px))] grid-cols-2 gap-1 rounded-full p-1.5">
        {TABBAR.map((t) => {
          const active = tabIsActive(t, pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              prefetch="intent"
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-center gap-1.5 rounded-full text-[13px] transition-colors ${active ? "bg-accent/15 font-semibold text-accent" : "text-ink-3 active:text-ink"}`}
            >
              <Icon size={18} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
