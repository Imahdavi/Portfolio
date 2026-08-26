const { del, list } = require('@vercel/blob');

const API_URL = 'https://portfolio-api.alireza-mahdavi.workers.dev';

// Collects every media URL the live site actually points at, so the handler
// below can refuse to delete any of them. Both stores are read fresh on each
// call rather than cached — a stale copy here would mean deleting something
// that had just been put back into use.
async function referencedUrls() {
  const refs = new Set();
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      if (node.includes('.blob.vercel-storage.com/')) refs.add(node.split('?')[0]);
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') Object.values(node).forEach(walk);
  };
  const [projects, settings] = await Promise.all([
    fetch(`${API_URL}/api/projects`).then(r => r.json()),
    fetch(`${API_URL}/api/settings`).then(r => r.json()),
  ]);
  walk(projects);
  walk(settings);
  return refs;
}

/* Deletes redundant copies from the Blob store.

   Deleting is the one Blob operation with no undo, and this endpoint has no
   auth in front of it (the site has no auth system to hang one on), so it is
   built so that the worst an unexpected caller can do is drop files nothing
   points at:

   - anything the projects or settings data currently references is refused,
     re-checked live on every call rather than trusted from the request;
   - a URL is only deletable if another blob of the exact same byte length is
     staying behind, i.e. it is a redundant copy rather than the only one;
   - capped per call, so a runaway loop can't walk the whole store.

   The caller still picks which copy of each group to keep — it has hashed the
   candidates and knows which one the re-pointed references now use — but it
   cannot talk this into deleting anything that is actually in service. */
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'POST only' });
  }
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const urls = body && body.urls;
    if (!Array.isArray(urls) || !urls.length) {
      return response.status(400).json({ error: 'urls[] required' });
    }
    if (urls.length > 100) {
      return response.status(400).json({ error: 'refusing more than 100 at once' });
    }
    const clean = urls.map(u => String(u).split('?')[0]);
    const bad = clean.filter(u => !/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(u));
    if (bad.length) {
      return response.status(400).json({ error: 'non-blob url', sample: bad[0] });
    }

    const refs = await referencedUrls();
    const inUse = clean.filter(u => refs.has(u));
    if (inUse.length) {
      return response.status(409).json({
        error: 'refusing to delete media the site still references',
        count: inUse.length,
        sample: inUse.slice(0, 3),
      });
    }

    // Build size buckets over the whole store, then require that each target
    // leaves at least one same-size blob behind.
    const bySize = new Map();
    const byUrl = new Map();
    let cursor;
    do {
      const page = await list({ cursor, limit: 1000 });
      page.blobs.forEach(b => {
        byUrl.set(b.url, b.size);
        bySize.set(b.size, (bySize.get(b.size) || 0) + 1);
      });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    const targets = clean.filter(u => byUrl.has(u));   // already-gone URLs are a no-op
    const perSizeDeleting = new Map();
    targets.forEach(u => {
      const s = byUrl.get(u);
      perSizeDeleting.set(s, (perSizeDeleting.get(s) || 0) + 1);
    });
    const wouldOrphan = targets.filter(u => {
      const s = byUrl.get(u);
      return (bySize.get(s) || 0) - (perSizeDeleting.get(s) || 0) < 1;
    });
    if (wouldOrphan.length) {
      return response.status(409).json({
        error: 'refusing to delete the last copy at its size',
        count: wouldOrphan.length,
        sample: wouldOrphan.slice(0, 3),
      });
    }

    if (targets.length) await del(targets);
    return response.status(200).json({
      deleted: targets.length,
      skippedAlreadyGone: clean.length - targets.length,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
