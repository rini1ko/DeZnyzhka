// Розбір публічної веб-версії Telegram-каналу (https://t.me/s/<канал>). Без залежностей.
export const DEAL_RE = /знижк|акці[яюїє]|-\s?\d{1,2}\s?%|\b\d\s?\+\s?\d\b|безкоштовн|подарунок/i;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };
const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&(amp|lt|gt|quot|nbsp);/g, (_, n) => NAMED[n]);

export function parsePosts(html) {
  return html.split('tgme_widget_message_wrap').slice(1).map(chunk => {
    const url = chunk.match(/class="tgme_widget_message_date"[^>]*href="([^"]+)"/)?.[1];
    const date = chunk.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const raw = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!url || !raw) return null;
    const text = decode(raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    return { url, date, text };
  }).filter(Boolean);
}

const iso = d => d.toISOString().slice(0, 10);
export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d);
}

// "до 25.11" -> дата завершення; якщо не знайшли, +7 днів (guessed=true, на перевірку)
export function guessEndDate(text, today) {
  const m = text.match(/до\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/i);
  if (m) {
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
    let date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && date < today) date = `${y + 1}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(date))) return { date, guessed: false };
  }
  return { date: addDays(today, 7), guessed: true };
}
