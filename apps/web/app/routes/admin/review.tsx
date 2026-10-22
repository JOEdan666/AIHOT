import { SITE } from "@aihot/industry/site";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/review";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, Card, Empty, Textarea, Time } from "../../features/admin/ui";

interface ReviewNote { noteId: number; body: string; articleId: string | null; title: string | null }
interface Review {
  weekStart: string;
  recurring: Array<{ slug: string; name: string; count: number }>;
  changed: ReviewNote[];
  objections: ReviewNote[];
  connections: Array<{ title: string; why: string; topics: string[] }>;
  nextAction: string;
  actionDone: boolean;
  generatedAt: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<{ review: Review | null }>(request, "/api/admin/review");
}

export const meta: Route.MetaFunction = () => [{ title: `每周回顾 · ${SITE.name} 后台` }];

function Notes({ items, empty }: { items: ReviewNote[]; empty: string }) {
  if (items.length === 0) return <p className="text-[13.5px] text-ink-4">{empty}</p>;
  return (
    <ul className="space-y-2 text-[13.5px] leading-relaxed">
      {items.map((n) => (
        <li key={n.noteId}>
          <p className="text-ink">{n.body}</p>
          {n.articleId && n.title && <a href={`/items/${n.articleId}`} target="_blank" rel="noreferrer" className="text-[12.5px] text-ink-4 hover:text-accent">关于：{n.title}</a>}
        </li>
      ))}
    </ul>
  );
}

function NextAction({ review }: { review: Review }) {
  const { run, pending } = useAdminAction();
  const [text, setText] = useState(review.nextAction);
  useEffect(() => setText(review.nextAction), [review.nextAction]);
  return (
    <Card title="下一步小行动" right={review.actionDone ? "已完成" : "这周做完它"}>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={160} className="!min-h-[60px]" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" busy={pending !== null} disabled={text.trim() === review.nextAction} onClick={() => run("PATCH", "/api/admin/review", { weekStart: review.weekStart, nextAction: text }, { success: "已保存" })}>保存修改</Button>
        <Button size="sm" tone={review.actionDone ? "secondary" : "primary"} onClick={() => run("PATCH", "/api/admin/review", { weekStart: review.weekStart, actionDone: !review.actionDone }, { success: review.actionDone ? "已改回未完成" : "完成了" })}>
          {review.actionDone ? "改回未完成" : "标记完成"}
        </Button>
      </div>
    </Card>
  );
}

export default function WeeklyReviewPage({ loaderData }: Route.ComponentProps) {
  const { review } = loaderData;
  const { run, pending } = useAdminAction();
  const generate = (
    <Button tone="primary" busy={pending !== null} onClick={() => run("POST", "/api/admin/review/generate", {}, { success: "已排队，一两分钟后刷新" })}>
      {review ? "重新生成本周回顾" : "生成本周回顾"}
    </Button>
  );
  return (
    <AdminPage title="每周回顾" subtitle="从你这一周在灵感本里写下的判断生成：反复关注的方向、改变的看法、反对意见，以及跨领域的连接和一件这周能做完的小事。" actions={generate}>
      {!review ? (
        <Empty>
          还没有回顾。先去 <Link to="/admin/desk" className="text-accent">灵感本</Link> 记几条判断；每周一早上会自动生成，也可以点右上角立即生成。
        </Empty>
      ) : (
        <div className="space-y-4">
          <p className="text-[12.5px] text-ink-4">
            {review.weekStart} 这一周 · 生成于 <Time at={review.generatedAt} />
          </p>
          <Card title="跨领域连接">
            {review.connections.length === 0 ? (
              <p className="text-[13.5px] text-ink-4">这周没有看出有依据的连接（或者模型调用未开启）。</p>
            ) : (
              <ul className="space-y-3">
                {review.connections.map((c) => (
                  <li key={c.title}>
                    <h3 className="text-[15px] font-semibold text-ink">{c.title}</h3>
                    <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{c.why}</p>
                    {c.topics.length > 0 && <p className="mt-0.5 text-[12px] text-ink-4">连接：{c.topics.join(" × ")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <NextAction review={review} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="反复关注的方向">
              {review.recurring.length === 0 ? (
                <p className="text-[13.5px] text-ink-4">这周还没有哪个方向被你记过两次以上。</p>
              ) : (
                <ul className="space-y-1.5 text-[13.5px]">
                  {review.recurring.map((t) => (
                    <li key={t.slug}><a href={`/topics/${t.slug}`} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">{t.name}</a> <span className="text-ink-4">· {t.count} 条</span></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="改变的看法"><Notes items={review.changed} empty="这周没有记“改变看法”。" /></Card>
            <Card title="反对意见"><Notes items={review.objections} empty="这周没有记“反对意见”。" /></Card>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
