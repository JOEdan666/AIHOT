import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import type { Route } from "./+types/desk";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, FilterChips, Select, Textarea, Time } from "../../features/admin/ui";

type Kind = "thought" | "changed_mind" | "objection";
interface Note { id: number; articleId: string | null; kind: Kind; body: string; createdAt: string; updatedAt: string }
interface DeskItem { id: string; title: string; summary: string | null; url: string; category: string | null; tags: string[]; sourceName: string; at: string; notes: Note[] }
interface Data { items: DeskItem[]; looseNotes: Note[] }

const KIND_LABEL: Record<Kind, string> = { thought: "想法", changed_mind: "改变看法", objection: "反对意见" };
const KIND_TONE: Record<Kind, "muted" | "accent" | "warn"> = { thought: "muted", changed_mind: "accent", objection: "warn" };

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  return adminGet<Data>(request, `/api/admin/desk?days=${sp.get("days") ?? "7"}${sp.get("noted") === "1" ? "&noted=1" : ""}`);
}

export const meta: Route.MetaFunction = () => [{ title: `灵感本 · ${SITE.name} 后台` }];

function NoteRow({ n }: { n: Note }) {
  const { run, pending } = useAdminAction();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.body);
  const [kind, setKind] = useState<Kind>(n.kind);
  if (editing) {
    return (
      <li className="space-y-2 rounded-control bg-bg-sunk p-3">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="!w-auto">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
          <Button size="sm" tone="primary" busy={pending !== null} onClick={async () => { if (await run("PATCH", `/api/admin/notes/${n.id}`, { body, kind }, { success: "已保存" })) setEditing(false); }}>保存</Button>
          <Button size="sm" onClick={() => setEditing(false)}>取消</Button>
          <Button size="sm" tone="ghost" className="ml-auto text-hot" onClick={() => run("DELETE", `/api/admin/notes/${n.id}`, undefined, { success: "已删除" })}>删除</Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 text-[13.5px] leading-relaxed">
      <Badge tone={KIND_TONE[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-ink">{n.body}</p>
      <button type="button" className="shrink-0 text-[12px] text-ink-4 hover:text-accent" onClick={() => setEditing(true)}>编辑</button>
    </li>
  );
}

function NoteBox({ articleId }: { articleId: string | null }) {
  const { run, pending } = useAdminAction();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Kind>("thought");
  const submit = async () => {
    if (!body.trim()) return;
    if (await run("POST", "/api/admin/notes", { articleId, kind, body }, { success: "已记下", label: `note:${articleId ?? "loose"}` })) setBody("");
  };
  return (
    <div className="mt-2 space-y-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="这条让你想到什么？同意吗？" maxLength={2000} className="!min-h-[60px]" />
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`rounded-full px-2.5 py-1 text-[12.5px] ring-1 ${kind === k ? "bg-accent text-white ring-accent" : "text-ink-3 ring-line-strong"}`}>
            {KIND_LABEL[k]}
          </button>
        ))}
        <Button size="sm" tone="primary" className="ml-auto" busy={pending !== null} disabled={!body.trim()} onClick={submit}>记下</Button>
      </div>
    </div>
  );
}

export default function Desk({ loaderData }: Route.ComponentProps) {
  const { items, looseNotes } = loaderData;
  return (
    <AdminPage title="灵感本" subtitle="最近的精选，每条下面记一句你自己的判断。只有你自己看得到；每周一会据此生成回顾。">
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterChips param="days" options={[{ value: "", label: "最近 7 天" }, { value: "30", label: "最近 30 天" }]} />
        <FilterChips param="noted" options={[{ value: "", label: "全部精选" }, { value: "1", label: "只看记过的" }]} />
      </div>

      <Card title="不针对某一条的想法" className="mb-4">
        {looseNotes.length > 0 && <ul className="mb-3 space-y-2">{looseNotes.map((n) => <NoteRow key={n.id} n={n} />)}</ul>}
        <NoteBox articleId={null} />
      </Card>

      {items.length === 0 ? (
        <Empty>这段时间还没有精选内容。</Empty>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <article key={it.id} className="rounded-panel bg-surface p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-4">
                <span>{it.sourceName}</span>
                <Time at={it.at} />
                {it.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
              </div>
              <h3 className="mt-1 text-[15.5px] font-semibold leading-snug text-ink">
                <a href={`/items/${it.id}`} target="_blank" rel="noreferrer" className="hover:text-accent">{it.title}</a>
              </h3>
              {it.summary && <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-ink-3">{it.summary}</p>}
              {it.notes.length > 0 && <ul className="mt-3 space-y-2 border-t border-line pt-3">{it.notes.map((n) => <NoteRow key={n.id} n={n} />)}</ul>}
              <NoteBox articleId={it.id} />
            </article>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
