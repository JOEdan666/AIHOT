// The home page's week: the best selected items of the last seven days, one per story, a list that
// ends rather than a timeline to scroll. Topic threads come from topic-digests.ts.
import type { FeedItemSummary } from "@aihot/contracts/site";
import type { LaneKey } from "@aihot/contracts/taxonomy";
import { sql } from "../db.ts";
import { ITEM_COLUMNS, ITEM_FROM, laneCondition, selectedCondition, toFeedItemSummary, type ItemRow } from "./items.ts";

const WINDOW_MS = 7 * 86400_000;
export const WEEK_TOP_LIMIT = 10;

export async function loadWeekTop(opts: { lane?: LaneKey | null; limit?: number } = {}, now = new Date()): Promise<FeedItemSummary[]> {
  const limit = opts.limit ?? WEEK_TOP_LIMIT;
  // Read a few more than shown: several reports of one story count once.
  const rows = await sql<ItemRow[]>`
    SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
    WHERE ${selectedCondition(now)} AND p.timeline_at > ${new Date(now.getTime() - WINDOW_MS)} AND p.timeline_at <= ${now}
      ${laneCondition(opts.lane ?? null)}
    ORDER BY p.score DESC NULLS LAST, p.timeline_at DESC
    LIMIT ${limit * 3}`;
  const seen = new Set<number>();
  const out: FeedItemSummary[] = [];
  for (const r of rows) {
    if (r.story_id) {
      if (seen.has(r.story_id)) continue;
      seen.add(r.story_id);
    }
    out.push(toFeedItemSummary(r));
    if (out.length === limit) break;
  }
  return out;
}
