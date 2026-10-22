// The owner's own judgments, kept next to the items that prompted them. Private: read and written only
// through the admin routes for the signed-in owner, never through a public exit.
import { z } from "zod";
import { sql } from "../db.ts";
import { selectedCondition } from "../publication/items.ts";

export const NOTE_KINDS = ["thought", "changed_mind", "objection"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const NoteInput = z.object({
  articleId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).nullable().default(null),
  kind: z.enum(NOTE_KINDS).default("thought"),
  body: z.string().trim().min(1).max(2000),
});
const NotePatch = z.object({ kind: z.enum(NOTE_KINDS).optional(), body: z.string().trim().min(1).max(2000).optional() });

export interface Note {
  id: number;
  articleId: string | null;
  kind: NoteKind;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteRow { id: string; article_id: string | null; kind: NoteKind; body: string; created_at: Date; updated_at: Date }
const toNote = (r: NoteRow): Note => ({ id: Number(r.id), articleId: r.article_id, kind: r.kind, body: r.body, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

export class NoteInputError extends Error {
  statusCode = 400;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new NoteInputError(r.error.issues[0]?.message ?? "invalid note");
  return r.data;
}

export async function addNote(owner: string, input: unknown): Promise<Note> {
  const data = parse(NoteInput, input);
  if (data.articleId) {
    const [exists] = await sql`SELECT 1 FROM articles WHERE id = ${data.articleId}`;
    if (!exists) throw new NoteInputError("unknown article");
  }
  const [row] = await sql<NoteRow[]>`
    INSERT INTO notes (owner, article_id, kind, body) VALUES (${owner}, ${data.articleId}, ${data.kind}, ${data.body})
    RETURNING id, article_id, kind, body, created_at, updated_at`;
  return toNote(row!);
}

/** Only the owner's own notes can be changed; another owner's id reads as not found. */
export async function updateNote(owner: string, id: number, input: unknown): Promise<Note | null> {
  const data = parse(NotePatch, input);
  const [row] = await sql<NoteRow[]>`
    UPDATE notes SET kind = coalesce(${data.kind ?? null}, kind), body = coalesce(${data.body ?? null}, body), updated_at = now()
    WHERE id = ${id} AND owner = ${owner}
    RETURNING id, article_id, kind, body, created_at, updated_at`;
  return row ? toNote(row) : null;
}

export async function deleteNote(owner: string, id: number): Promise<{ deleted: boolean } | null> {
  const res = await sql`DELETE FROM notes WHERE id = ${id} AND owner = ${owner}`;
  return res.count ? { deleted: true } : null;
}

export interface DeskItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  tags: string[];
  sourceName: string;
  at: string;
  notes: Note[];
}

/**
 * The desk: recent selected items, newest first, each with the owner's notes on it, plus notes written
 * without an item. `noted` keeps only items the owner has written on.
 */
export async function loadDesk(owner: string, opts: { days?: number; noted?: boolean } = {}, now = new Date()): Promise<{ items: DeskItem[]; looseNotes: Note[] }> {
  const since = new Date(now.getTime() - (opts.days ?? 7) * 86400_000);
  const items = await sql<{ id: string; title: string; summary: string | null; url: string; category: string | null; tags: string[]; source_name: string; at: Date }[]>`
    SELECT p.article_id AS id, p.title, p.summary, p.url, p.category, p.tags, s.name AS source_name, p.timeline_at AS at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${selectedCondition(now)} AND p.timeline_at > ${since}
      ${opts.noted ? sql`AND EXISTS (SELECT 1 FROM notes n WHERE n.article_id = p.article_id AND n.owner = ${owner})` : sql``}
    ORDER BY p.timeline_at DESC
    LIMIT 80`;
  const notes = await sql<NoteRow[]>`
    SELECT id, article_id, kind, body, created_at, updated_at FROM notes
    WHERE owner = ${owner} AND (article_id IN ${sql(items.length ? items.map((i) => i.id) : [""])} OR article_id IS NULL)
    ORDER BY created_at DESC`;
  const byItem = new Map<string, Note[]>();
  for (const n of notes) if (n.article_id) byItem.set(n.article_id, [...(byItem.get(n.article_id) ?? []), toNote(n)]);
  return {
    items: items.map((i) => ({ id: i.id, title: i.title, summary: i.summary, url: i.url, category: i.category, tags: i.tags, sourceName: i.source_name, at: i.at.toISOString(), notes: byItem.get(i.id) ?? [] })),
    looseNotes: notes.filter((n) => !n.article_id).map(toNote),
  };
}
