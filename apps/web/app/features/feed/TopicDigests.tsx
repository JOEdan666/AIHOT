import { Link } from "react-router";
import type { TopicDigestEntry } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";

function span(d: TopicDigestEntry): string {
  const md = (iso: string) => beijingDate(new Date(iso)).slice(5).replace("-", "/");
  return `${md(d.windowFrom)}–${md(d.windowTo)}`;
}

/** One topic's last seven days: the headline, the condensed paragraph, how many items it was written from. */
export function TopicDigestCard({ digest, linkTopic = false }: { digest: TopicDigestEntry; linkTopic?: boolean }) {
  return (
    <article className="card px-4 py-3.5 lg:px-5">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px] text-ink-4">
        {linkTopic ? (
          <Link to={`/topics/${digest.slug}`} className="chip">
            {digest.name}
          </Link>
        ) : (
          <span>最近七天</span>
        )}
        <span className="num" suppressHydrationWarning>
          {span(digest)} · 据 {digest.itemCount} 条精选
        </span>
      </div>
      <h3 className="text-[16px] font-bold leading-[1.45] text-ink">{digest.headline}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{digest.digest}</p>
    </article>
  );
}

/** The home page's topic threads: a few busy topics, each condensed, linking to its topic page. */
export function TopicDigests({ entries }: { entries: TopicDigestEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="topic-threads" className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="topic-threads" className="text-[14px] font-semibold text-ink">本周主题线索</h2>
        <Link to="/topics" className="text-[12.5px] text-ink-4">
          全部主题
        </Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map((d) => (
          <TopicDigestCard key={d.slug} digest={d} linkTopic />
        ))}
      </div>
    </section>
  );
}
