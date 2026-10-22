// The owner's weekly review: which topics they kept coming back to, where they changed their mind, what
// they objected to (all straight from their notes of the last seven days), plus at most two cross-domain
// connections and one small next action written by the model from those notes and the week's topic
// digests. Composed in a worker job; the admin page only reads it.
import { z } from "zod";
import { addDays, beijingDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { loadTopicDigests } from "../publication/topic-digests.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { listTopics, topicMatchTags } from "../publication/topics.ts";
import type { NoteKind } from "./notes.ts";

export const CONNECTIONS_PROMPT_VERSION = promptVersion("weekly-connections");
const SYSTEM = promptText("weekly-connections");
/** A topic counts as "kept coming back to" when this many of the week's noted items fall in it. */
export const RECURRING_MIN = 2;

const Schema = z.object({
  connections: z.array(z.object({ title: z.string().min(2).max(60), why: z.string().min(4).max(300), topics: z.array(z.string().max(40)).max(4).catch([]) })).max(2).catch([]),
  nextAction: z.string().min(4).max(160),
});

export interface ReviewNote { noteId: number; body: string; articleId: string | null; title: string | null }
export interface WeeklyReview {
  weekStart: string;
  recurring: Array<{ slug: string; name: string; count: number }>;
  changed: ReviewNote[];
  objections: ReviewNote[];
  connections: Array<{ title: string; why: string; topics: string[] }>;
  nextAction: string;
  actionDone: boolean;
  generatedAt: string;
}

/** Monday of the Beijing week containing `now`. */
export function weekStartOf(now: Date): string {
  const today = beijingDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7));
}

function fallbackAction(recurring: WeeklyReview["recurring"], objections: ReviewNote[]): string {
  if (objections[0]) return `挑你写的这条反对意见，找一个真实的潜在用户或从业者用 20 分钟问清楚：${objections[0].body.slice(0, 40)}`;
  if (recurring[0]) return `这周你反复在看「${recurring[0].name}」。先给它写一条“如果我错了，原因会是什么”，再找一个做这件事的人聊 15 分钟。`;
  return "这周记下的判断还不多。挑一条最让你在意的内容，写一句你同不同意、为什么。";
}

export async function composeWeeklyReview(owner: string, now = new Date()): Promise<WeeklyReview> {
  const weekStart = weekStartOf(now);
  const since = new Date(now.getTime() - 7 * 86400_000);
  const notes = await sql<{ id: string; kind: NoteKind; body: string; article_id: string | null; title: string | null; tags: string[] | null }[]>`
    SELECT n.id, n.kind, n.body, n.article_id, p.title, p.tags
    FROM notes n LEFT JOIN publications p ON p.article_id = n.article_id
    WHERE n.owner = ${owner} AND n.created_at > ${since} AND n.created_at <= ${now}
    ORDER BY n.created_at`;

  const topics = await listTopics();
  const recurring = topics
    .map((t) => {
      const match = new Set(topicMatchTags(t));
      const items = new Set(notes.filter((n) => n.article_id && (n.tags ?? []).some((tag) => match.has(tag))).map((n) => n.article_id));
      return { slug: t.slug, name: t.name, count: items.size };
    })
    .filter((t) => t.count >= RECURRING_MIN)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6);
  const asItem = (n: (typeof notes)[number]): ReviewNote => ({ noteId: Number(n.id), body: n.body, articleId: n.article_id, title: n.title });
  const changed = notes.filter((n) => n.kind === "changed_mind").map(asItem);
  const objections = notes.filter((n) => n.kind === "objection").map(asItem);

  // The model part: only when there is something of the owner's to work from. Disabled model calls,
  // a spent budget or a bad answer leave the connections empty and fall back to a plain next action.
  let connections: WeeklyReview["connections"] = [];
  let nextAction = fallbackAction(recurring, objections);
  let receiptId: number | null = null;
  if (notes.length > 0) {
    try {
      const digests = await loadTopicDigests({ limit: 6 }, now);
      const label: Record<NoteKind, string> = { thought: "想法", changed_mind: "改变看法", objection: "反对意见" };
      const user = [
        "我这一周写下的判断：",
        ...notes.map((n) => `- [${label[n.kind]}] ${n.body}${n.title ? `（关于：${n.title}）` : ""}`),
        "",
        "这一周的主题概括：",
        ...(digests.length ? digests.map((d) => `- ${d.name}：${d.headline}。${d.digest}`) : ["（暂无）"]),
      ].join("\n");
      const res = await chatJson({
        // The subject names what the answer was written from, so changed notes get a fresh answer.
        model: await modelFor("report"), purpose: "weekly_connections",
        subject: `review:${owner}@${weekStart}#${sha256(stableJson(notes.map((n) => [n.id, n.kind, n.body]))).slice(0, 12)}`, promptVersion: CONNECTIONS_PROMPT_VERSION,
        system: SYSTEM, user, schema: Schema, temperature: 0.4, maxTokens: 900,
      });
      connections = res.data.connections;
      nextAction = res.data.nextAction;
      receiptId = res.receiptId;
    } catch (error) {
      console.error(`weekly review connections for ${owner} skipped:`, error instanceof Error ? error.message : error);
    }
  }

  await sql.begin(async (tx) => {
    // Regenerating refreshes everything except a next action the owner has edited or ticked.
    await tx`
      INSERT INTO weekly_reviews (owner, week_start, recurring, changed, objections, connections, next_action, receipt_id, generated_at)
      VALUES (${owner}, ${weekStart}, ${sql.json(recurring)}, ${sql.json(changed as never)}, ${sql.json(objections as never)}, ${sql.json(connections)}, ${nextAction}, ${receiptId}, ${now})
      ON CONFLICT (owner, week_start) DO UPDATE SET
        recurring = EXCLUDED.recurring, changed = EXCLUDED.changed, objections = EXCLUDED.objections,
        connections = EXCLUDED.connections, receipt_id = EXCLUDED.receipt_id, generated_at = EXCLUDED.generated_at,
        next_action = CASE WHEN weekly_reviews.action_edited OR weekly_reviews.action_done THEN weekly_reviews.next_action ELSE EXCLUDED.next_action END`;
    if (receiptId !== null) await completeReceipt(tx, receiptId);
  });
  return (await loadWeeklyReview(owner, weekStart))!;
}

interface ReviewRow {
  week_start: string; recurring: WeeklyReview["recurring"]; changed: ReviewNote[]; objections: ReviewNote[];
  connections: WeeklyReview["connections"]; next_action: string; action_done: boolean; generated_at: Date;
}

/** The given week's review, or the latest one. */
export async function loadWeeklyReview(owner: string, weekStart?: string): Promise<WeeklyReview | null> {
  const [r] = await sql<ReviewRow[]>`
    SELECT week_start::text AS week_start, recurring, changed, objections, connections, next_action, action_done, generated_at FROM weekly_reviews
    WHERE owner = ${owner} ${weekStart ? sql`AND week_start = ${weekStart}` : sql``}
    ORDER BY week_start DESC LIMIT 1`;
  if (!r) return null;
  return { weekStart: r.week_start, recurring: r.recurring, changed: r.changed, objections: r.objections, connections: r.connections, nextAction: r.next_action, actionDone: r.action_done, generatedAt: r.generated_at.toISOString() };
}

const ActionPatch = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nextAction: z.string().trim().min(1).max(160).optional(), actionDone: z.boolean().optional() });

export async function updateReviewAction(owner: string, input: unknown): Promise<WeeklyReview | null> {
  const r = ActionPatch.safeParse(input);
  if (!r.success) throw Object.assign(new Error(r.error.issues[0]?.message ?? "invalid"), { statusCode: 400 });
  const { weekStart, nextAction, actionDone } = r.data;
  const res = await sql`
    UPDATE weekly_reviews SET
      next_action = coalesce(${nextAction ?? null}, next_action),
      action_edited = action_edited OR ${nextAction !== undefined},
      action_done = coalesce(${actionDone ?? null}, action_done)
    WHERE owner = ${owner} AND week_start = ${weekStart}`;
  return res.count ? loadWeeklyReview(owner, weekStart) : null;
}

/** Owners who wrote anything in the last seven days (the weekly schedule reviews each of them). */
export async function activeOwners(now = new Date()): Promise<string[]> {
  const rows = await sql<{ owner: string }[]>`SELECT DISTINCT owner FROM notes WHERE created_at > ${new Date(now.getTime() - 7 * 86400_000)}`;
  return rows.map((r) => r.owner);
}
