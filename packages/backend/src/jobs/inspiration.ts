// Inspiration jobs: the owner's weekly review (its connections are a model call, so it runs here).
import type { PgBoss } from "pg-boss";
import { activeOwners, composeWeeklyReview } from "../inspiration/review.ts";
import { ensureQueue, enqueue, QUEUES } from "./queue.ts";

export async function registerInspirationJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.weeklyReview);
  await boss.work<{ owner: string }>(QUEUES.weeklyReview, { localConcurrency: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    if (!job) return;
    const review = await composeWeeklyReview(job.data.owner);
    return { weekStart: review.weekStart, connections: review.connections.length };
  });
}

/** Asked for from the admin page: one pending job per owner at a time. */
export function requestWeeklyReview(owner: string): Promise<string | null> {
  return enqueue(QUEUES.weeklyReview, { owner }, { singletonKey: `review:${owner}` });
}

/** Monday morning: a review for everyone who wrote something last week. */
export async function scheduleWeeklyReviews(): Promise<{ queued: number }> {
  const owners = await activeOwners();
  for (const owner of owners) await requestWeeklyReview(owner);
  return { queued: owners.length };
}
