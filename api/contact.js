/* Relays a note from the site's contact form to Telegram.
 *
 * Why Telegram and not storage: an attachment posted here is handed straight
 * to Telegram and never lands in Blob, Supabase or the repo. That matters —
 * Supabase and Blob were both quota-blocked by egress, and repo uploads cost
 * a commit and a deploy each. This path stores nothing, so a busy week costs
 * the same as a quiet one.
 *
 * The bot token never reaches the browser; it lives in this function's env.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN  from @BotFather
 *   TELEGRAM_CHAT_ID    the chat to post into (yours)
 */

const MAX_TEXT = 4000;                       // Telegram caps a message at 4096
const MAX_FILE = 4 * 1024 * 1024;            // Hobby request bodies stop at ~4.5MB

// Very small in-memory throttle. Serverless instances come and go, so this is
// a speed bump against a naive flood, not a real rate limiter.
const seen = new Map();
function tooOften(ip) {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 60_000) seen.delete(k);
  const last = seen.get(ip) || 0;
  if (now - last < 20_000) return true;
  seen.set(ip, now);
  return false;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function tg(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `${method} failed`);
  return data;
}

// Telegram wants multipart for actual bytes; base64 arrives from the browser.
async function tgFile(token, method, chatId, field, filename, base64, mime, caption) {
  const bin = Buffer.from(base64, 'base64');
  if (bin.length > MAX_FILE) throw new Error('attachment too large');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
  form.append(field, new Blob([bin], { type: mime || 'application/octet-stream' }), filename);
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `${method} failed`);
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // Told apart from a real failure so the page can fall back to mail rather
  // than telling the sender their note went nowhere.
  if (!token || !chatId) return res.status(503).json({ error: 'not_configured' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { message = '', email = '', instagram = '', telegram = '', website = '',
            image = null, voice = null } = b;

    // Honeypot: a real person never sees this field, a bot fills everything in.
    if (website) return res.status(200).json({ ok: true });

    const msg = String(message).slice(0, MAX_TEXT).trim();
    const mail = String(email).trim();
    if (!msg && !image && !voice) return res.status(400).json({ error: 'empty' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'bad_email' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (tooOften(ip)) return res.status(429).json({ error: 'slow_down' });

    const lines = [
      '<b>New note from the site</b>',
      '',
      esc(msg) || '<i>(no text)</i>',
      '',
      `✉️ ${esc(mail)}`,
    ];
    if (instagram) lines.push(`📷 ${esc(instagram)}`);
    if (telegram)  lines.push(`✈️ ${esc(telegram)}`);

    await tg(token, 'sendMessage', {
      chat_id: chatId, text: lines.join('\n'),
      parse_mode: 'HTML', disable_web_page_preview: true,
    });

    // Attachments follow the text, so the note still arrives if one fails.
    if (image && image.data) {
      await tgFile(token, 'sendPhoto', chatId, 'photo',
                   image.name || 'photo.webp', image.data, image.type, `from ${esc(mail)}`);
    }
    if (voice && voice.data) {
      await tgFile(token, 'sendVoice', chatId, 'voice',
                   voice.name || 'voice.ogg', voice.data, voice.type || 'audio/ogg',
                   `from ${esc(mail)}`);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
