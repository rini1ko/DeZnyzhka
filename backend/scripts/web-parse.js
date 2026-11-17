// Робота з HTML сторінок закладів. Без залежностей.
import { DEAL_RE, decode } from './telegram-parse.js';

export function htmlToText(html) {
  const text = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(text).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function extractWebLines(html) {
  const lines = htmlToText(html).split('\n').filter(l => l.length >= 15 && l.length <= 300 && DEAL_RE.test(l));
  return [...new Set(lines)].slice(0, 15);
}

export function promoLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (!/акці|знижк|promo|sale|offer|discount|special/i.test(`${m[1]} ${label}`)) continue;
    try {
      const u = new URL(m[1], base);
      if (u.origin === new URL(base).origin) out.add(u.href);
    } catch {}
  }
  out.delete(base);
  return [...out].slice(0, 3);
}

// Збираємо великі банери/афіші (до 3 шт. на сторінку), ігноруючи іконки, логотипи та соцмережі
export function promoImages(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<img\s[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\b(?:src|data-src|data-lazy-src)="([^"]+)"/i)?.[1];
    if (!src || src.startsWith('data:')) continue;
    if (/\.(svg|ico|gif)(\?|$)/i.test(src)) continue;
    if (/logo|icon|avatar|pixel|sprite|flag|facebook|instagram|telegram|viber|visa|mastercard/i.test(tag)) continue;

    const alt = tag.match(/\balt="([^"]*)"/i)?.[1] || '';
    const isPromoBanner = /акці|знижк|promo|sale|offer|banner|slider|hero|special/i.test(`${src} ${alt} ${tag}`);
    if (!isPromoBanner) continue;

    try {
      const u = new URL(src, base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.href);
    } catch {}
  }
  return [...out].slice(0, 3);
}