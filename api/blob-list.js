const { list } = require('@vercel/blob');

// The Projects-list media picker's library. It reads the Blob store rather
// than the boards, so a file stays offerable after the last project using
// it drops it — deriving the library from board contents meant removing
// media from its only project also erased it from the picker.
//
// Runs server-side because listing needs BLOB_READ_WRITE_TOKEN, which can't
// be exposed to the browser. Only pathname/url/type are returned; nothing
// here is sensitive, the URLs are public already.
module.exports = async function handler(request, response) {
  try {
    const out = [];
    let cursor;
    do {
      const page = await list({ cursor, limit: 1000 });
      page.blobs.forEach(b => {
        const type = /\.(mp4|webm|mov|m4v)$/i.test(b.pathname) ? 'video'
                   : /\.(png|jpe?g|jfif|webp|gif|avif|svg)$/i.test(b.pathname) ? 'image'
                   : null;
        if (type) out.push({ type, src: b.url, pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt });
      });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    // Newest first — the file you just uploaded is the one you're looking for.
    out.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(out);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
