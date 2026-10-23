import type { LbConfidence, LbStability } from "@aihot/contracts/leaderboard";
import { LB_CONFIDENCE_LABELS } from "@aihot/contracts/leaderboard";

const DOT: Record<LbConfidence, string> = {
  HIGH: "bg-ok",
  MEDIUM: "bg-accent",
  LOW: "bg-amber",
};

function rangeText(s: LbStability): string {
  return s.from === s.to ? `第 ${s.from} 名` : `${s.from}—${s.to} 名`;
}

/** Confidence as a dotted label. On desktop, hovering a sensitive ranking shows its scenario rank range. */
export function EvidenceBadge({ confidence, stability, rank }: { confidence: LbConfidence; stability: LbStability | null; rank: number }) {
  const label = LB_CONFIDENCE_LABELS[confidence];
  const chip = (
    <small className="inline-flex items-center gap-1.5 text-[11px] leading-[17px] text-ink-4">
      <span className={`size-[5px] shrink-0 rounded-full ${DOT[confidence]}`} aria-hidden="true" />
      {label}
    </small>
  );
  if (!stability) return chip;
  const moved = stability.from !== stability.to || stability.unavailable > 0 || stability.incomplete > 0;
  return (
    <span className="group/tip relative inline-flex" tabIndex={moved ? 0 : -1}>
      {chip}
      {moved && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 -translate-x-1/2 rounded-tile border border-line bg-raised backdrop-blur-xl p-3 text-left text-[12px] leading-relaxed text-ink-2 opacity-0 shadow-[var(--shadow-pop)] transition-opacity duration-150 group-hover/tip:opacity-100 group-focus/tip:opacity-100 md:block"
        >
          <span className="block text-[11px] text-ink-4">名次浮动范围</span>
          <span className="num block text-[15px] font-semibold text-ink">{rangeText(stability)}</span>
          <span className="mt-1.5 block text-ink-3">
            在 {stability.scenarios} 个对照情景中重新检查资格后的名次。
            {stability.unavailable > 0 && ` ${stability.unavailable} 个情景下参评证据不足。`}
            不是置信区间。
          </span>
        </span>
      )}
    </span>
  );
}
