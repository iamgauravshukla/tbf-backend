import { Router } from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import {
  createPost, updatePost, deletePost, getPost, getPublishedBySlug,
  listPosts, listPublished, readMins,
} from '../lib/posts.js';

// ── PUBLIC: what the website reads ──────────────────────────────────────────
export const postsPublicRouter = Router();

// List published posts. ?related=<treatment-slug> narrows to posts that mention
// a treatment (drives the "read first" links on treatment pages).
postsPublicRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { total, posts } = await listPublished({ limit, offset, related: req.query.related });
    res.json({ ok: true, total, posts });
  } catch (err) { next(err); }
});

postsPublicRouter.get('/:slug', async (req, res, next) => {
  try {
    const post = await getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, post: { ...post, readMins: readMins(post.content) } });
  } catch (err) { next(err); }
});

// ── ADMIN: the blog editor (admins + managers) ──────────────────────────────
export const blogAdminRouter = Router();
blogAdminRouter.use(requireAuth, requireRole('admin', 'manager'));

blogAdminRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { total, posts } = await listPosts({ status: req.query.status, q: req.query.q, limit, offset });
    res.json({ ok: true, total, posts });
  } catch (err) { next(err); }
});

blogAdminRouter.get('/:id', async (req, res, next) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, post });
  } catch (err) { next(err); }
});

blogAdminRouter.post('/', async (req, res, next) => {
  try {
    const post = await createPost(req.body || {}, req.user);
    res.status(201).json({ ok: true, post });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

blogAdminRouter.patch('/:id', async (req, res, next) => {
  try {
    const post = await updatePost(req.params.id, req.body || {});
    if (!post) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, post });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

blogAdminRouter.delete('/:id', async (req, res, next) => {
  try {
    const gone = await deletePost(req.params.id);
    if (!gone) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
