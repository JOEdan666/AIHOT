// Topic digests as the public exits read them: the latest one per topic while it still describes the
// last seven days, and only while every item it was written from is still public and selected (a
// withdrawal hides it until the next run rewrites it from what is left).
import type { TopicDigestEntry } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { selectedCondition } from "./items.ts";

/** A digest older than this no longer describes "the last seven days" and is not shown. */
const SHOW_FOR_MS = 8 * 86400_000;

export async function loadTopicDigests(opts: { slug?: string; limit?: number } = {}, now = new Date()): Promise<TopicDigestEntry[]> {
  const rows = await sql<{ slug: string; name: string; headline: string; digest: string; insight: string | null; window_from: Date; window_to: Date; n: number }[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (d.topic_slug) d.topic_slug AS slug, t.name, d.headline, d.digest, d.insight, d.window_from, d.window_to,
        d.article_ids, cardinality(d.article_ids) AS n, d.created_at
      FROM topic_digests d JOIN topics t ON t.slug = d.topic_slug
      WHERE TRUE ${opts.slug ? sql`AND d.topic_slug = ${opts.slug}` : sql``}
      ORDER BY d.topic_slug, d.version DESC
    ) latest
    WHERE latest.created_at > ${new Date(now.getTime() - SHOW_FOR_MS)}
      AND NOT EXISTS (
        SELECT 1 FROM unnest(latest.article_ids) AS a(id)
        WHERE NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id AND ${selectedCondition(now)}))`;
  return rows
    .sort((a, b) => b.window_to.getTime() - a.window_to.getTime() || b.n - a.n)
    .slice(0, opts.limit ?? rows.length)
    .map((r) => ({ slug: r.slug, name: r.name, headline: r.headline, digest: r.digest, insight: r.insight, windowFrom: r.window_from.toISOString(), windowTo: r.window_to.toISOString(), itemCount: r.n }));
}
