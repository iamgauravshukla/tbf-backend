import path from 'node:path';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import express, { Router } from 'express';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../lib/auth.js';

// Uploaded blog imagery lives beside the JSON store so one persistent disk
// (a volume mounted at DATA_DIR) covers both. Served back at /uploads/<name>.
export const uploadsDir = path.join(config.dataDir, 'uploads');

// The browser's declared content type is not trusted — the first bytes decide
// the format, and with it the extension the file is saved under.
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 5 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12))) return 'avif';
  return null;
}

const safeName = (s) => String(s || '')
  .toLowerCase().replace(/\.[a-z0-9]+$/i, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  .slice(0, 60) || 'image';

const publicUrl = (req, name) => `${req.protocol}://${req.get('host')}/uploads/${name}`;

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth, requireRole('admin', 'manager'));

// The image arrives as the raw request body (fetch with the File as the body,
// original name in ?filename=) — no multipart parser dependency needed. The
// stored name is rebuilt from scratch, so nothing user-supplied touches the
// filesystem path.
uploadsRouter.post('/', express.raw({ type: 'image/*', limit: '8mb' }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      return res.status(400).json({ ok: false, error: 'no_image' });
    const ext = sniff(req.body);
    if (!ext) return res.status(415).json({ ok: false, error: 'unsupported_type' });
    const name = `${safeName(req.query.filename)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await fsp.mkdir(uploadsDir, { recursive: true });
    await fsp.writeFile(path.join(uploadsDir, name), req.body);
    res.status(201).json({ ok: true, filename: name, url: publicUrl(req, name) });
  } catch (err) { next(err); }
});

// Media list for the editor's cover-image picker, newest first.
uploadsRouter.get('/', async (req, res, next) => {
  try {
    let names = [];
    try { names = await fsp.readdir(uploadsDir); } catch { /* nothing uploaded yet */ }
    const files = await Promise.all(names
      .filter((n) => /\.(jpe?g|png|webp|gif|avif)$/i.test(n))
      .map(async (n) => {
        const st = await fsp.stat(path.join(uploadsDir, n));
        return { filename: n, url: publicUrl(req, n), size: st.size, uploadedAt: st.mtime.toISOString() };
      }));
    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    res.json({ ok: true, files: files.slice(0, 200) });
  } catch (err) { next(err); }
});
