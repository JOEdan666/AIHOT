// Topic digests: a topic's last seven days condensed from its selected items, written only when there is
// enough to condense, not rewritten for an unchanged set, shown on the topic page and the home strip.
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { composeTopicDigest } from "@aihot/backend/events/topic-digest";
import { loadTopicDigests } from "@aihot/backend/publication/topic-digests";
import { setVisibility } from "@aihot/backend/admin/content";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-topic-digest-${T}`;
const SLUG = `test-topic-${T}`;
const TAG = `测试主题-${T}`;
const requests: Array<{ system: string; user: string }> = [];
let insight: string | undefined;
const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  requests.push({ system: body.messages[0]!.content, user: body.messages.at(-1)!.content });
  const content = { headline: `桌面机器人这周变便宜了 ${T}`, digest: `这七天有三个团队发布了低成本桌面机器人，做法都是用现成舵机加开源控制代码，面向想自己动手的爱好者。${T}`, ...(insight === undefined ? {} : { insight }) };
  return { id: `stub-${requests.length}`, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "one-model", DIGEST_MODEL: "default", MODEL_CALLS_ENABLED: "true" });
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Test topic digest', 'rss', 'T1', 'editorial', '2100-01-01')`;
  await sql`INSERT INTO topics (slug, name, grp, tags, definition, position) VALUES (${SLUG}, ${`测试主题 ${T}`}, 'field', ${[TAG]}, '测试用主题', 9999)`;
});
after(async () => {
  await sql`DELETE FROM topics WHERE slug = ${SLUG}`;
  await provider.close();
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
async function selected(title: string): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}-${n}`, title, bodyText: `${title} `.repeat(10), bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  } as never);
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', 'indie', ${`${title}-${T}`}, '摘要', '理由', 80, true, ${["小而美", TAG]})`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  return articleId;
}

test("with fewer than three items there is nothing to condense and no model call", async () => {
  await selected("低成本桌面机器人 A");
  await selected("低成本桌面机器人 B");
  assert.deepEqual(await composeTopicDigest(SLUG), { updated: false });
  assert.equal(requests.length, 0);
});

test("three items: one digest written from them, shown on the topic page and the home strip", async () => {
  await selected("低成本桌面机器人 C");
  const res = await composeTopicDigest(SLUG);
  assert.deepEqual(res, { updated: true, version: 1 });
  assert.equal(requests.length, 1);
  assert.ok(requests[0]!.system.includes("主题编辑"));
  for (const t of ["A", "B", "C"]) assert.ok(requests[0]!.user.includes(`低成本桌面机器人 ${t}-${T}`), t);
  const [row] = await sql<{ article_ids: string[]; receipt_id: number }[]>`SELECT article_ids, receipt_id FROM topic_digests WHERE topic_slug = ${SLUG}`;
  assert.equal(row!.article_ids.length, 3);
  const [receipt] = await sql<{ purpose: string; status: string }[]>`SELECT purpose, status FROM receipts WHERE id = ${row!.receipt_id}`;
  assert.equal(receipt!.purpose, "topic_digest");

  const [digest] = await loadTopicDigests({ slug: SLUG });
  assert.equal(digest!.headline, `桌面机器人这周变便宜了 ${T}`);
  assert.equal(digest!.itemCount, 3);
  assert.equal(digest!.insight, null, "no insight line in the answer: none shown");

  const page = await app.inject({ method: "GET", url: `/api/site/topics/${SLUG}` });
  assert.equal(page.statusCode, 200);
  assert.equal(JSON.parse(page.body).digest.headline, digest!.headline);
  const home = JSON.parse((await app.inject({ method: "GET", url: "/api/site/timeline" })).body);
  assert.ok(Array.isArray(home.topicDigests));
  const filtered = JSON.parse((await app.inject({ method: "GET", url: "/api/site/timeline?lane=startup" })).body);
  assert.equal(filtered.topicDigests, null, "only the unfiltered home shows the strip");
});

test("the same items are not written again; a new item rewrites", async () => {
  assert.deepEqual(await composeTopicDigest(SLUG), { updated: false });
  assert.equal(requests.length, 1);
  await selected("低成本桌面机器人 D");
  assert.deepEqual(await composeTopicDigest(SLUG), { updated: true, version: 2 });
  assert.equal(requests.length, 2);
  assert.equal((await loadTopicDigests({ slug: SLUG })).length, 1, "the page reads the latest version only");
});

test("an insight line is kept when the model gives one, blank counts as none", async () => {
  insight = `  做爱好者套件比做成品门槛低，国内淘宝渠道现成 ${T} `;
  await selected("低成本桌面机器人 E");
  assert.equal((await composeTopicDigest(SLUG)).updated, true);
  assert.ok(requests.at(-1)!.system.includes("insight"));
  assert.equal((await loadTopicDigests({ slug: SLUG }))[0]!.insight, insight.trim());
  const home = JSON.parse((await app.inject({ method: "GET", url: "/api/site/week" })).body);
  assert.equal(home.topicDigests.find((d: { slug: string }) => d.slug === SLUG).insight, insight.trim());

  insight = "   ";
  await selected("低成本桌面机器人 F");
  assert.equal((await composeTopicDigest(SLUG)).updated, true);
  assert.equal((await loadTopicDigests({ slug: SLUG }))[0]!.insight, null);
  insight = undefined;
});

test("a withdrawn item hides the digest written from it, on the topic page too", async () => {
  const [digest] = await loadTopicDigests({ slug: SLUG });
  assert.ok(digest);
  const [row] = await sql<{ article_ids: string[] }[]>`SELECT article_ids FROM topic_digests WHERE topic_slug = ${SLUG} ORDER BY version DESC LIMIT 1`;
  await setVisibility(row!.article_ids[0]!, { visibility: "withdrawn", reason: "test", version: 0 }, "test");
  assert.deepEqual(await loadTopicDigests({ slug: SLUG }), []);
  const page = await app.inject({ method: "GET", url: `/api/site/topics/${SLUG}` });
  assert.equal(JSON.parse(page.body).digest, null);
});
