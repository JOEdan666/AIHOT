import { Link } from "react-router";
import type { FeedItemSummary } from "@aihot/contracts/site";
import { FeedItem } from "./FeedItem";

/** The week's best items: a short list that ends, each with a way to write a line about it. */
export function WeekTop({ items, moreHref }: { items: FeedItemSummary[]; moreHref: string }) {
  return (
    <section>
      {items.length === 0 ? (
        <p className="card px-4 py-6 text-center text-[14px] text-ink-3">这一周这里还没有精选内容。</p>
      ) : (
        <ol className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="max-lg:card max-lg:px-4 max-lg:pb-2.5 max-lg:pt-3.5">
              <FeedItem item={it} />
              {/* Outside the card's full-size link, so it stays clickable. */}
              <div className="flex justify-end lg:mt-1 lg:pr-3">
                <Link to={`/admin/desk?item=${it.id}#item-${it.id}`} className="text-[12.5px] text-accent">记一笔</Link>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Link to={moreHref} className="mt-4 block text-center text-[13px] text-ink-3 hover:text-ink">看全部动态 →</Link>
    </section>
  );
}
