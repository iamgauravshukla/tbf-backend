import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';

// Blog posts, written from the admin dashboard and served to the public site.
// Postgres when DATABASE_URL is set, else the JSON store — same as everything.
// Content is Markdown; the site renders it (with an auto table of contents).

const POSTS = 'posts';
export const POST_STATUSES = ['draft', 'published'];

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));
const rowToPost = (r) => ({
  id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt || '',
  content: r.content || '', coverImage: r.cover_image,
  seoTitle: r.seo_title, metaDescription: r.meta_description,
  related: typeof r.related === 'string' ? JSON.parse(r.related) : (r.related || []),
  status: r.status, authorId: r.author_id, authorName: r.author_name || '',
  authorRole: r.author_role || '', publishedAt: iso(r.published_at),
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

export const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);

export const readMins = (content) =>
  Math.max(1, Math.ceil(String(content || '').trim().split(/\s+/).length / 200));

// Strip the full content off list payloads; add the reading time.
const summary = (p) => {
  const { content, ...rest } = p;
  return { ...rest, readMins: readMins(content) };
};

async function slugTaken(slug, exceptId) {
  if (pgEnabled) {
    const r = await query('SELECT id FROM posts WHERE slug = $1', [slug]);
    return r.rows[0] ? r.rows[0].id !== exceptId : false;
  }
  const list = await read(POSTS);
  return list.some((p) => p.slug === slug && p.id !== exceptId);
}

async function uniqueSlug(base, exceptId) {
  let slug = base || 'post';
  let n = 2;
  while (await slugTaken(slug, exceptId)) slug = `${base}-${n++}`;
  return slug;
}

function validate({ title, excerpt, metaDescription }) {
  if (!title || String(title).trim().length < 3) throw Object.assign(new Error('title'), { status: 400 });
  if (excerpt && String(excerpt).length > 500) throw Object.assign(new Error('excerpt_too_long'), { status: 400 });
  if (metaDescription && String(metaDescription).length > 170) throw Object.assign(new Error('meta_description_too_long'), { status: 400 });
}

export async function createPost(data, actor = null) {
  validate(data);
  const now = new Date().toISOString();
  const status = POST_STATUSES.includes(data.status) ? data.status : 'draft';
  const post = {
    id: crypto.randomUUID(),
    slug: await uniqueSlug(slugify(data.slug || data.title)),
    title: String(data.title).trim(),
    excerpt: String(data.excerpt || '').trim(),
    content: String(data.content || ''),
    coverImage: data.coverImage || null,
    seoTitle: String(data.seoTitle || data.title).slice(0, 160),
    metaDescription: String(data.metaDescription || data.excerpt || '').slice(0, 170),
    related: Array.isArray(data.related) ? data.related.slice(0, 6) : [],
    status,
    authorId: actor?.id || null,
    authorName: String(data.authorName || actor?.name || 'The Better Face team').trim(),
    authorRole: String(data.authorRole || '').trim(),
    publishedAt: status === 'published' ? (data.publishedAt ? iso(data.publishedAt) : now) : null,
    createdAt: now,
    updatedAt: now,
  };
  if (pgEnabled) {
    await query(
      `INSERT INTO posts (id,slug,title,excerpt,content,cover_image,seo_title,meta_description,related,
        status,author_id,author_name,author_role,published_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)`,
      [post.id, post.slug, post.title, post.excerpt, post.content, post.coverImage, post.seoTitle,
        post.metaDescription, JSON.stringify(post.related), post.status, post.authorId,
        post.authorName, post.authorRole, post.publishedAt, post.createdAt, post.updatedAt]);
    return post;
  }
  const list = await read(POSTS);
  list.unshift(post);
  await persist(POSTS);
  return post;
}

export async function updatePost(id, patch = {}) {
  const existing = await getPost(id);
  if (!existing) return null;
  if (patch.title !== undefined || patch.excerpt !== undefined || patch.metaDescription !== undefined) {
    validate({ title: patch.title ?? existing.title, excerpt: patch.excerpt, metaDescription: patch.metaDescription });
  }

  const next = { ...existing };
  if (patch.title !== undefined) next.title = String(patch.title).trim();
  if (patch.slug !== undefined && slugify(patch.slug) !== existing.slug) {
    next.slug = await uniqueSlug(slugify(patch.slug) || slugify(next.title), id);
  }
  if (patch.excerpt !== undefined) next.excerpt = String(patch.excerpt).trim();
  if (patch.content !== undefined) next.content = String(patch.content);
  if (patch.coverImage !== undefined) next.coverImage = patch.coverImage || null;
  if (patch.seoTitle !== undefined) next.seoTitle = String(patch.seoTitle).slice(0, 160);
  if (patch.metaDescription !== undefined) next.metaDescription = String(patch.metaDescription).slice(0, 170);
  if (patch.related !== undefined) next.related = Array.isArray(patch.related) ? patch.related.slice(0, 6) : [];
  if (patch.authorName !== undefined) next.authorName = String(patch.authorName).trim();
  if (patch.authorRole !== undefined) next.authorRole = String(patch.authorRole).trim();
  if (patch.status !== undefined && POST_STATUSES.includes(patch.status)) {
    next.status = patch.status;
    if (patch.status === 'published' && !next.publishedAt) next.publishedAt = new Date().toISOString();
  }
  next.updatedAt = new Date().toISOString();

  if (pgEnabled) {
    await query(
      `UPDATE posts SET slug=$2,title=$3,excerpt=$4,content=$5,cover_image=$6,seo_title=$7,
        meta_description=$8,related=$9::jsonb,status=$10,author_name=$11,author_role=$12,
        published_at=$13,updated_at=$14 WHERE id=$1`,
      [id, next.slug, next.title, next.excerpt, next.content, next.coverImage, next.seoTitle,
        next.metaDescription, JSON.stringify(next.related), next.status, next.authorName,
        next.authorRole, next.publishedAt, next.updatedAt]);
    return next;
  }
  const list = await read(POSTS);
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return null;
  list[i] = next;
  await persist(POSTS);
  return next;
}

export async function deletePost(id) {
  if (pgEnabled) {
    const r = await query('DELETE FROM posts WHERE id = $1 RETURNING id', [id]);
    return r.rowCount > 0;
  }
  const list = await read(POSTS);
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  await persist(POSTS);
  return true;
}

export async function getPost(id) {
  if (pgEnabled) {
    const r = await query('SELECT * FROM posts WHERE id = $1', [id]);
    return r.rows[0] ? rowToPost(r.rows[0]) : null;
  }
  const list = await read(POSTS);
  return list.find((p) => p.id === id) || null;
}

export async function getPublishedBySlug(slug) {
  if (pgEnabled) {
    const r = await query("SELECT * FROM posts WHERE slug = $1 AND status = 'published'", [slug]);
    return r.rows[0] ? rowToPost(r.rows[0]) : null;
  }
  const list = await read(POSTS);
  return list.find((p) => p.slug === slug && p.status === 'published') || null;
}

// Admin list: everything, filterable.
export async function listPosts({ status, q, limit = 50, offset = 0 } = {}) {
  if (pgEnabled) {
    const params = [];
    const clauses = [];
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); const p = `$${params.length}`; clauses.push(`(title ILIKE ${p} OR excerpt ILIKE ${p} OR content ILIKE ${p})`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const t = await query(`SELECT COUNT(*)::int AS n FROM posts ${where}`, params);
    params.push(limit); const lp = params.length;
    params.push(offset); const op = params.length;
    const r = await query(`SELECT * FROM posts ${where} ORDER BY updated_at DESC LIMIT $${lp} OFFSET $${op}`, params);
    return { total: t.rows[0].n, posts: r.rows.map(rowToPost).map(summary) };
  }
  let list = await read(POSTS);
  if (status) list = list.filter((p) => p.status === status);
  if (q) { const s = q.toLowerCase(); list = list.filter((p) => [p.title, p.excerpt, p.content].some((f) => (f || '').toLowerCase().includes(s))); }
  const sorted = [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return { total: sorted.length, posts: sorted.slice(offset, offset + limit).map(summary) };
}

// Public list: published only, newest first, no full content.
export async function listPublished({ limit = 20, offset = 0, related } = {}) {
  if (pgEnabled) {
    const params = [];
    const clauses = ["status = 'published'"];
    if (related) { params.push(JSON.stringify([related])); clauses.push(`related @> $${params.length}::jsonb`); }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const t = await query(`SELECT COUNT(*)::int AS n FROM posts ${where}`, params);
    params.push(limit); const lp = params.length;
    params.push(offset); const op = params.length;
    const r = await query(`SELECT * FROM posts ${where} ORDER BY published_at DESC LIMIT $${lp} OFFSET $${op}`, params);
    return { total: t.rows[0].n, posts: r.rows.map(rowToPost).map(summary) };
  }
  let list = (await read(POSTS)).filter((p) => p.status === 'published');
  if (related) list = list.filter((p) => (p.related || []).includes(related));
  const sorted = [...list].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { total: sorted.length, posts: sorted.slice(offset, offset + limit).map(summary) };
}
