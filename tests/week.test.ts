// The home page's week: the best selected items of the last seven days, one per story, by lane, a list
// that ends; the old filter links on / now land on /all.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { loadWeekTop } from "@aihot/backend/publication/week";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-week-${T}`;
const app = await buildApp();
const DAY = 86400_000;

let n = 0;
async function item(title: string, opts: { score: number; category: string; ago?: number; selected?: boolean }): Promise<string> {
  n += 1;
  const at = new Date(Date.now() - (opts.ago ?? 1) * DAY);
  const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/week-${T}-${n}`, title, bodyText: `${title} `.repeat(10), bodyStatus: "ok", via: "fetch", publishedAt: at } as never);
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${opts.category}, ${`${title}-${T}`}, '摘要', '理由', ${opts.score}, ${opts.selected ?? true}, ${["小而美"]})`;
  await publishArticle(articleId, { releasedAt: at });
  return articleId;
}

const ids: Record<string, string> = {};
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Test week', 'rss', 'T1', 'editorial', '2100-01-01')`;
  ids.top = await item("YC 新公司", { score: 99, category: "startups" });
  ids.robot = await item("机器人新品", { score: 98, category: "robotics" });
  ids.old = await item("十天前的大新闻", { score: 100, category: "startups", ago: 10 });
  ids.unselected = await item("没入选的", { score: 100, category: "startups", selected: false });
  ids.sameStoryA = await item("同一件事 A", { score: 97, category: "startups" });
  ids.sameStoryB = await item("同一件事 B", { score: 96, category: "startups" });
  const [story] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title) VALUES (gen_random_uuid(), ${`同一件事 ${T}`}) RETURNING id`;
  await sql`UPDATE publications SET story_id = ${story!.id} WHERE article_id IN ${sql([ids.sameStoryA, ids.sameStoryB])}`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

const mine = (items: Array<{ id: string }>) => items.map((i) => i.id).filter((id) => Object.values(ids).includes(id));

test("the week is the last seven days' selected items by score, one per story", async () => {
  const got = mine(await loadWeekTop({ limit: 40 }));
  assert.deepEqual(got, [ids.top, ids.robot, ids.sameStoryA]);
});

test("a lane keeps only its categories, and the list is capped", async () => {
  assert.deepEqual(mine(await loadWeekTop({ lane: "frontier", limit: 40 })), [ids.robot]);
  assert.ok((await loadWeekTop({ limit: 2 })).length <= 2);
});

test("the week api answers per lane and refuses an unknown one", async () => {
  const res = await app.inject({ method: "GET", url: "/api/site/week?lane=startup" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.lane, "startup");
  assert.ok(Array.isArray(body.topicDigests));
  assert.ok(mine(body.items).includes(ids.top) && !mine(body.items).includes(ids.robot));
  assert.equal((await app.inject({ method: "GET", url: "/api/site/week?lane=nope" })).statusCode, 400);
});
