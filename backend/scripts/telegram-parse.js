// Розбір публічної веб-версії Telegram-каналу (https://t.me/s/<канал>). Без залежностей.
export const DEAL_RE = /знижк|акці[яюїє]|-\s?\d{1,2}\s?%|\b\d\s?\+\s?\d\b|безкоштовн|подарунок|комбо|ланч|щаслив|happy\s?hour|кешбек/i;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };
export const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&(amp|lt|gt|quot|nbsp);/g, (_, n) => NAMED[n]);

export function parsePosts(html) {
  return html.split('tgme_widget_message_wrap').slice(1).map(chunk => {
    const url = chunk.match(/class="tgme_widget_message_date"[^>]*href="([^"]+)"/)?.[1];
    const date = chunk.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const raw = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const text = raw ? decode(raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '';

    // Витягуємо прикріплені фотографії з поста (афіші, банери акцій)
    const images = [...chunk.matchAll(/tgme_widget_message_photo_wrap[^>]*style="[^"]*background-image:url\('([^']+)'\)/gi)]
      .map(m => m[1])
      .filter(Boolean);

    if (!url || (!text && !images.length)) return null;
    return { url, date, text, images };
  }).filter(Boolean);
}

const iso = d => d.toISOString().slice(0, 10);
export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

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