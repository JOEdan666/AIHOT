// Topic digest: what happened in a topic over the last seven days, as one or a few threads rather than
// item by item. Written from the topic's selected items; rewritten only when that set or what the items
// say has changed. Read by the topic page and the home page's topic strip.
import { z } from "zod";
import { beijingDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { selectedCondition } from "../publication/items.ts";
import { listTopics, topicMatchTags, type TopicRow } from "../publication/topics.ts";

export const TOPIC_DIGEST_PROMPT_VERSION = promptVersion("topic-digest");
const SYSTEM = promptText("topic-digest");

const WINDOW_MS = 7 * 86400_000;
/** Fewer selected items than this in the window: nothing to condense, the list says it all. */
export const TOPIC_DIGEST_MIN_ITEMS = 3;
/** Topics written per run, the busiest first: bounds the paid calls of one run. */
const TOPICS_PER_RUN = 12;
/** A digest older than this no longer describes "the last seven days" and is not shown. */
const SHOW_FOR_MS = 8 * 86400_000;

const Schema = z.object({
  headline: z.string().min(4).max(80),
  digest: z.string().min(40).max(1500),
});

interface WindowItem { id: string; title: string; summary: string | null; source_name: string; at: Date }

async function windowItems(topic: Pick<TopicRow, "entity_id" | "tags">, now: Date): Promise<WindowItem[]> {
  return sql<WindowItem[]>`
    SELECT p.article_id AS id, p.title, p.summary, s.name AS source_name, p.timeline_at AS at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${selectedCondition(now)}
      AND p.timeline_at > ${new Date(now.getTime() - WINDOW_MS)} AND p.timeline_at <= ${now}
      AND p.tags && ${topicMatchTags(topic)}::text[]
    ORDER BY p.score DESC NULLS LAST, p.timeline_at DESC
    LIMIT 30`;
}

export async function composeTopicDigest(slug: string, now = new Date()): Promise<{ updated: boolean; version?: number }> {
  const topic = (await listTopics()).find((t) => t.slug === slug);
  if (!topic) return { updated: false };
  const items = await windowItems(topic, now);
  if (items.length < TOPIC_DIGEST_MIN_ITEMS) return { updated: false };
  const inputsHash = sha256(stableJson([...items].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, r.title, r.summary ?? ""])));
  const [last] = await sql<{ version: number; inputs_hash: string }[]>`
    SELECT version, inputs_hash FROM topic_digests WHERE topic_slug = ${slug} ORDER BY version DESC LIMIT 1`;
  if (last?.inputs_hash === inputsHash) return { updated: false };

  const lines = [...items]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((r) => `${beijingDate(r.at)}｜${r.source_name}｜${r.title}｜${(r.summary ?? "").slice(0, 200)}`);
  const user = `主题：${topic.name}\n主题说明：${topic.definition}\n\n最近七天的条目（按时间）：\n${lines.join("\n")}`;
  const res = await chatJson({
    model: await modelFor("digest"), purpose: "topic_digest", subject: `topic:${slug}@${beijingDate(now)}`, promptVersion: TOPIC_DIGEST_PROMPT_VERSION,
    system: SYSTEM, user, schema: Schema, temperature: 0.3, maxTokens: 1000,
  });
  const version = (last?.version ?? 0) + 1;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO topic_digests (topic_slug, version, headline, digest, window_from, window_to, article_ids, inputs_hash, receipt_id)
             VALUES (${slug}, ${version}, ${res.data.headline}, ${res.data.digest}, ${new Date(now.getTime() - WINDOW_MS)}, ${now},
                     ${items.map((r) => r.id)}, ${inputsHash}, ${res.receiptId})`;
    await completeReceipt(tx, res.receiptId);
  });
  return { updated: true, version };
}

/** Daily: the busiest topics of the last seven days. One topic failing does not stop the others. */
export async function composeTopicDigests(now = new Date()): Promise<{ written: number; skipped: number; failed: number }> {
  const topics = await listTopics();
  const counted: Array<{ slug: string; n: number }> = [];
  for (const t of topics) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM publications p
      WHERE ${selectedCondition(now)}
        AND p.timeline_at > ${new Date(now.getTime() - WINDOW_MS)} AND p.tags && ${topicMatchTags(t)}::text[]`;
    if (row!.n >= TOPIC_DIGEST_MIN_ITEMS) counted.push({ slug: t.slug, n: row!.n });
  }
  counted.sort((a, b) => b.n - a.n);
  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const { slug } of counted.slice(0, TOPICS_PER_RUN)) {
    try {
      if ((await composeTopicDigest(slug, now)).updated) written += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error(`topic digest ${slug} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { written, skipped, failed };
}

export interface TopicDigest {
  slug: string;
  name: string;
  headline: string;
  digest: string;
  windowFrom: string;
  windowTo: string;
  itemCount: number;
}

/** The latest digest of each topic that is still current, newest first (the topic page reads one, the home strip a few). */
export async function loadTopicDigests(opts: { slug?: string; limit?: number } = {}, now = new Date()): Promise<TopicDigest[]> {
  const rows = await sql<{ slug: string; name: string; headline: string; digest: string; window_from: Date; window_to: Date; n: number }[]>`
    SELECT DISTINCT ON (d.topic_slug) d.topic_slug AS slug, t.name, d.headline, d.digest, d.window_from, d.window_to,
      cardinality(d.article_ids) AS n
    FROM topic_digests d JOIN topics t ON t.slug = d.topic_slug
    WHERE d.created_at > ${new Date(now.getTime() - SHOW_FOR_MS)} ${opts.slug ? sql`AND d.topic_slug = ${opts.slug}` : sql``}
    ORDER BY d.topic_slug, d.version DESC`;
  return rows
    .sort((a, b) => b.window_to.getTime() - a.window_to.getTime() || b.n - a.n)
    .slice(0, opts.limit ?? rows.length)
    .map((r) => ({ slug: r.slug, name: r.name, headline: r.headline, digest: r.digest, windowFrom: r.window_from.toISOString(), windowTo: r.window_to.toISOString(), itemCount: r.n }));
}
