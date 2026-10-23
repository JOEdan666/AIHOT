// Inspiration jobs: the owner's weekly review (its connections are a model call, so it runs here).
import type { PgBoss } from "pg-boss";
import { addDays } from "@aihot/contracts/time";
import { activeOwners, composeWeeklyReview, weekStartOf } from "../inspiration/review.ts";
import { ensureQueue, enqueue, QUEUES } from "./queue.ts";

export async function registerInspirationJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.weeklyReview);
  // A failed model call throws after the lists are saved, so the queue's retries can add the connections.
  await boss.work<{ owner: string; weekStart?: string }>(QUEUES.weeklyReview, { localConcurrency: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    if (!job) return;
    const review = await composeWeeklyReview(job.data.owner, { weekStart: job.data.weekStart });
    return { weekStart: review.weekStart, connections: review.connections.length };
  });
}

/** Asked for from the admin page (the current week so far), or by the schedule (a given week). One pending job per owner and week. */
export function requestWeeklyReview(owner: string, weekStart?: string): Promise<string | null> {
  return enqueue(QUEUES.weeklyReview, { owner, ...(weekStart ? { weekStart } : {}) }, { singletonKey: `review:${owner}:${weekStart ?? "current"}` });
}

/** Monday morning: the week just ended, for everyone who wrote something in it. */
export async function scheduleWeeklyReviews(now = new Date()): Promise<{ queued: number }> {
  const lastWeek = addDays(weekStartOf(now), -7);
  const owners = await activeOwners(lastWeek);
  for (const owner of owners) await requestWeeklyReview(owner, lastWeek);
  return { queued: owners.length };
}
