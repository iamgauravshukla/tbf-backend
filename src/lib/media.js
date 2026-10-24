import { pgEnabled, query } from './pg.js';

// Blog image storage. When Postgres is configured, images are stored in the DB
// so they persist across redeploys (Railway's container disk is ephemeral).
// Without Postgres (local dev) the routes fall back to the filesystem.

export const EXT_MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

export const mediaInDb = pgEnabled;

// Store an image. Returns true when written to the DB, false when the caller
// should write to the filesystem instead.
export async function saveMedia(name, contentType, buf) {
  if (!pgEnabled) return false;
  await query(
    `INSERT INTO uploads (name, content_type, bytes, size)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO NOTHING`,
    [name, contentType, buf, buf.length],
  );
  return true;
}

// Fetch one image for serving. null when not in the DB (caller falls back).
export async function getMedia(name) {
  if (!pgEnabled) return null;
  const r = await query('SELECT content_type, bytes FROM uploads WHERE name = $1', [name]);
  if (!r.rows[0]) return null;
  return { contentType: r.rows[0].content_type, bytes: r.rows[0].bytes };
}

// List images for the editor's picker, newest first. null when not using the DB.
export async function listMedia(limit = 200) {
  if (!pgEnabled) return null;
  const r = await query(
    'SELECT name, size, created_at FROM uploads ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return r.rows.map((x) => ({ filename: x.name, size: x.size, uploadedAt: new Date(x.created_at).toISOString() }));
}
