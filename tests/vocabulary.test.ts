// The industry vocabulary: every tag a topic matches on can actually be stored, so no topic page is
// left permanently empty by a synonym that rewrites its tag away.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeTags } from "@aihot/backend/editorial/vocabulary";

const topics = JSON.parse(readFileSync(new URL("../industry/topics.json", import.meta.url), "utf8")) as { topics: Array<{ slug: string; entityId?: string; tags: string[] }> };

test("every topic tag survives normalisation as itself", () => {
  for (const t of topics.topics) {
    for (const tag of t.tags) {
      if (tag.startsWith("entity:")) continue;
      // Behind a category tag, as the model writes them.
      const out = normalizeTags(["其他", tag], { max: 6 });
      assert.ok(out.includes(tag), `${t.slug}: "${tag}" became ${JSON.stringify(out)}`);
    }
  }
});

test("融资 and YC are their own tags, not rewritten into broader ones", () => {
  assert.deepEqual(normalizeTags(["创业公司", "融资", "YC"]), ["创业公司", "融资", "YC"]);
});
