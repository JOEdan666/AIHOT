// The inspiration notebook: notes are private to their owner (through the admin api, with session and
// CSRF), and the weekly review is built from the owner's own notes: recurring topics, changed views and
// objections straight from them, connections from the model, a next action the owner's edit survives.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { sha256 } from "@aihot/backend/lib/ids";
import { composeWeeklyReview, loadWeeklyReview, ReviewModelError, updateReviewAction, weekStartOf } from "@aihot/backend/inspiration/review";
import { scheduleWeeklyReviews } from "@aihot/backend/jobs/inspiration";
import { addDays } from "@aihot/contracts/time";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-inspiration-${T}`;
const SLUG = `test-insp-topic-${T}`;
const TAG = `灵感测试-${T}`;
const asks: string[] = [];
let modelDown = false;
const provider = await stub((_hit, req) => {
  if (modelDown) return new Reply(503, { error: "unavailable" });
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  asks.push(body.messages.at(-1)!.content);
  const content = { connections: [{ title: `把桌面机器人卖给牙医诊所 ${T}`, why: "两条判断都指向小诊所缺人手；最大的不确定是诊所愿不愿为硬件付费。", topics: ["桌面机器人", "B2B"] }], nextAction: `找两家牙医诊所问前台每天花多少时间接电话 ${T}` };
  return { id: `stub-${asks.length}`, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "one-model", REPORT_MODEL: "default", MODEL_CALLS_ENABLED: "true" });
const app = await buildApp();

async function adminSession(email: string) {
  const [u] = await sql<{ id: number }[]>`INSERT INTO admin_users (email, display_name) VALUES (${email}, 'tester') RETURNING id`;
  const token = randomBytes(24).toString("base64url");
  const csrf = randomBytes(12).toString("base64url");
  await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, expires_at) VALUES (${sha256(token)}, ${u!.id}, ${csrf}, now() + interval '1 hour')`;
  return { owner: `admin:${u!.id}`, headers: { cookie: `aihot_admin=${token}`, "x-csrf-token": csrf, "content-type": "application/json" } };
}
let alice: Awaited<ReturnType<typeof adminSession>>;
let bob: Awaited<ReturnType<typeof adminSession>>;
const items: string[] = [];

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Test inspiration', 'rss', 'T1', 'editorial', '2100-01-01')`;
  await sql`INSERT INTO topics (slug, name, grp, tags, definition, position) VALUES (${SLUG}, ${`灵感测试主题 ${T}`}, 'field', ${[TAG]}, '测试', 9998)`;
  for (let i = 1; i <= 2; i++) {
    const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${T}-${i}`, title: `桌面机器人 ${i}`, bodyText: "正文 ".repeat(20), bodyStatus: "ok", via: "fetch", publishedAt: new Date() } as never);
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected, tags)
              VALUES (${articleId}, 1, 'rule', 'pass', 'indie', ${`桌面机器人 ${i}-${T}`}, '摘要', '理由', 80, true, ${["小而美", TAG]})`;
    await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
    items.push(articleId);
  }
  alice = await adminSession(`alice-${T}@test`);
  bob = await adminSession(`bob-${T}@test`);
});
after(async () => {
  await sql`DELETE FROM topics WHERE slug = ${SLUG}`;
  await provider.close();
  await app.close();
  await stopBoss();
  await closeDb();
});

const call = (who: { headers: Record<string, string> }, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: who.headers, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });

test("notes need a session and CSRF, and stay with their owner", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/desk" })).statusCode, 401);
  const noCsrf = await app.inject({ method: "POST", url: "/api/admin/notes", headers: { cookie: alice.headers.cookie, "content-type": "application/json" }, payload: JSON.stringify({ body: "x" }) });
  assert.equal(noCsrf.statusCode, 403);

  const made = await call(alice, "POST", "/api/admin/notes", { articleId: items[0], kind: "objection", body: "诊所真的缺这个吗" });
  assert.equal(made.statusCode, 200);
  const note = JSON.parse(made.body) as { id: number };
  assert.equal((await call(alice, "POST", "/api/admin/notes", { body: "" })).statusCode, 400);
  assert.equal((await call(alice, "POST", "/api/admin/notes", { articleId: "no-such-item", body: "x" })).statusCode, 400);

  const aliceDesk = JSON.parse((await call(alice, "GET", "/api/admin/desk?noted=1")).body) as { items: Array<{ id: string; notes: unknown[] }> };
  assert.deepEqual(aliceDesk.items.map((i) => [i.id, i.notes.length]), [[items[0], 1]]);
  const bobDesk = JSON.parse((await call(bob, "GET", "/api/admin/desk?noted=1")).body) as { items: unknown[] };
  assert.equal(bobDesk.items.length, 0, "another owner sees none of it");

  assert.equal((await call(bob, "PATCH", `/api/admin/notes/${note.id}`, { body: "改掉" })).statusCode, 404);
  // As the admin page sends it: no body, so no content-type.
  const bobDelete = await app.inject({ method: "DELETE", url: `/api/admin/notes/${note.id}`, headers: { cookie: bob.headers.cookie, "x-csrf-token": bob.headers["x-csrf-token"]! } });
  assert.equal(bobDelete.statusCode, 404);
  assert.equal((await call(alice, "PATCH", "/api/admin/notes/abc", { body: "x" })).statusCode, 404, "a bad id is not found, not a server error");
  const edited = await call(alice, "PATCH", `/api/admin/notes/${note.id}`, { body: "诊所真的缺人手吗" });
  assert.equal(JSON.parse(edited.body).body, "诊所真的缺人手吗");
});

test("the weekly review comes from the owner's notes; the model adds connections and a next action", async () => {
  await call(alice, "POST", "/api/admin/notes", { articleId: items[1], kind: "changed_mind", body: "以前觉得桌宠只是玩具" });
  const review = await composeWeeklyReview(alice.owner);
  assert.equal(review.weekStart, weekStartOf(new Date()));
  assert.deepEqual(review.recurring.map((r) => [r.slug, r.count]), [[SLUG, 2]]);
  assert.deepEqual(review.changed.map((n) => n.body), ["以前觉得桌宠只是玩具"]);
  assert.deepEqual(review.objections.map((n) => n.body), ["诊所真的缺人手吗"]);
  assert.equal(review.connections[0]!.title, `把桌面机器人卖给牙医诊所 ${T}`);
  assert.equal(review.nextAction, `找两家牙医诊所问前台每天花多少时间接电话 ${T}`);
  assert.ok(asks.at(-1)!.includes("诊所真的缺人手吗") && asks.at(-1)!.includes("[反对意见]"), "the model reads the owner's own notes");
  assert.equal(await loadWeeklyReview(bob.owner), null, "the other owner has no review");
});

test("the same notes are not sent to the model twice", async () => {
  const n = asks.length;
  await composeWeeklyReview(alice.owner);
  assert.equal(asks.length, n);
});

test("an edited next action survives regeneration; with the model unavailable the review still comes, with a plain action", async () => {
  await updateReviewAction(alice.owner, { weekStart: weekStartOf(new Date()), nextAction: "我自己定的行动", actionDone: true });
  // A new note changes what the answer would be written from, so the model is asked again (and is down).
  await call(alice, "POST", "/api/admin/notes", { kind: "thought", body: "也许先做软件版" });
  modelDown = true;
  try {
    // The lists are saved, then the failure is thrown so the queued job retries.
    await assert.rejects(composeWeeklyReview(alice.owner), ReviewModelError);
    const again = (await loadWeeklyReview(alice.owner))!;
    assert.equal(again.nextAction, "我自己定的行动");
    assert.equal(again.actionDone, true);
    assert.deepEqual(again.connections, []);
    await sql`UPDATE weekly_reviews SET action_edited = false, action_done = false WHERE owner = ${alice.owner}`;
    await assert.rejects(composeWeeklyReview(alice.owner), ReviewModelError);
    const plain = (await loadWeeklyReview(alice.owner))!;
    assert.ok(plain.nextAction.includes("诊所真的缺人手吗"), "falls back to the owner's own objection");
  } finally {
    modelDown = false;
  }
});

test("generating from the admin page queues one job instead of calling the model", async () => {
  const before = asks.length;
  const res = await call(alice, "POST", "/api/admin/review/generate", {});
  assert.equal(res.statusCode, 200);
  assert.equal(asks.length, before, "no model call in the request");
  const [job] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'inspiration.review' AND data->>'owner' = ${alice.owner}`;
  assert.equal(job!.n, 1);
});

test("an item noted long ago is still listed among the noted ones", async () => {
  await sql`UPDATE publications SET timeline_at = now() - interval '90 days' WHERE article_id = ${items[0]}`;
  const recent = JSON.parse((await call(alice, "GET", "/api/admin/desk?days=30")).body) as { items: Array<{ id: string }> };
  assert.ok(!recent.items.some((i) => i.id === items[0]));
  const noted = JSON.parse((await call(alice, "GET", "/api/admin/desk?noted=1")).body) as { items: Array<{ id: string; notes: unknown[] }> };
  assert.ok(noted.items.some((i) => i.id === items[0] && i.notes.length > 0));
});

test("Monday's schedule reviews the week just ended, under that week's Monday", async () => {
  const lastWeek = addDays(weekStartOf(new Date()), -7);
  const [note] = await sql<{ id: number }[]>`
    INSERT INTO notes (owner, kind, body, created_at) VALUES (${bob.owner}, 'objection', '上周的反对意见', ${new Date(Date.parse(`${lastWeek}T12:00:00+08:00`))}) RETURNING id`;
  assert.ok(note);
  await scheduleWeeklyReviews();
  const jobs = await sql<{ data: { owner: string; weekStart?: string } }[]>`SELECT data FROM pgboss.job WHERE name = 'inspiration.review' AND data->>'owner' = ${bob.owner}`;
  assert.deepEqual(jobs.map((j) => j.data.weekStart), [lastWeek]);
  const review = await composeWeeklyReview(bob.owner, { weekStart: lastWeek });
  assert.equal(review.weekStart, lastWeek);
  assert.deepEqual(review.objections.map((o) => o.body), ["上周的反对意见"]);
  assert.equal((await composeWeeklyReview(bob.owner)).objections.length, 0, "this week's review does not take last week's notes");
});
