// Автопошук та автомодерація знижок (текст + афіші/банери) через Groq.
// Запуск: cd backend && npm run import
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { DEAL_RE, parsePosts, guessEndDate, addDays } from './telegram-parse.js';
import { extractWebLines, htmlToText, promoLinks, promoImages } from './web-parse.js';
import { extractDealsLLM, smartCut } from './llm-extract.js';
import { scoreDeal, hasProfanity, isBannedPromo } from '../src/moderation.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const manual = JSON.parse(readFileSync(new URL('../../infra/sources.json', import.meta.url), 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const MAX_AGE_DAYS = 14;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
};

const GROQ_KEY = process.env.GROQ_API_KEY;
const LLM_MAX = +(process.env.LLM_MAX_CALLS || 500);
let llmCalls = 0, llmOff = !GROQ_KEY, failed = 0;
const hash = t => createHash('md5').update(t).digest('hex').slice(0, 10);

const SKIP_DOMAINS = /(facebook\.com|vk\.com|instagram\.com|business\.site)/i;

const { data: withSite } = await db
  .from('places')
  .select('id, name, website')
  .not('website', 'is', null);

const seen = new Set(manual.map(m => m.url).filter(Boolean));
const auto = [];
for (const p of withSite || []) {
  const cleanUrl = p.website.trim().replace(/\/+$/, '');
  if (seen.has(cleanUrl) || SKIP_DOMAINS.test(cleanUrl)) continue;
  seen.add(cleanUrl);
  auto.push({ url: p.website, place: p.name, place_id: p.id });
}
const sources = [...manual, ...auto];

async function getHtml(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fromPage(html, page) {
  const text = htmlToText(html);
  const images = promoImages(html, page);
  const hasPromoHints = (text.length >= 150 && DEAL_RE.test(text)) || images.length > 0;

  if (!llmOff && llmCalls < LLM_MAX && hasPromoHints) {
    try {
      llmCalls++;
      await sleep(2300); // ~26 запитів/хв, безпечно в межах 30 RPM Groq
      const deals = await extractDealsLLM(text, {
        groqKey: GROQ_KEY,
        today,
        images,
      });
      return deals.map(d => ({
        source: 'web',
        url: `${page}#${hash(d.title + (d.ends_on || ''))}`,
        deal: d,
      }));
    } catch (e) {
      if (e.message.includes('RATE_LIMIT')) {
        console.log('… пауза 15с через ліміт Groq, пробую далі');
        await sleep(15000);
      } else {
        console.log(`… Groq: ${e.message}; для цієї сторінки прості правила`);
      }
    }
  }

  return extractWebLines(html).map(t => ({
    source: 'web',
    url: `${page}#${hash(t)}`,
    text: t,
  }));
}

async function collect(s) {
  if (s.channel) {
    const posts = parsePosts(await getHtml(`https://t.me/s/${s.channel}`))
      .filter(p => !p.date || (Date.now() - Date.parse(p.date)) / 864e5 <= MAX_AGE_DAYS)
      .filter(p => DEAL_RE.test(p.text) || p.images.length > 0)
      .slice(0, 15);

    const items = [];
    for (const p of posts) {
      if (!llmOff && llmCalls < LLM_MAX) {
        try {
          llmCalls++;
          await sleep(2300);
          const deals = await extractDealsLLM(p.text, {
            groqKey: GROQ_KEY,
            today,
            images: p.images,
          });
          for (const d of deals) {
            items.push({ source: 'telegram', url: p.url, deal: d });
          }
          continue;
        } catch (e) {
          if (e.message.includes('RATE_LIMIT')) llmOff = true;
        }
      }
      if (p.text && DEAL_RE.test(p.text)) {
        items.push({ source: 'telegram', url: p.url, text: p.text });
      }
    }
    return items;
  }

  if (!s.url) return [];
  const html = await getHtml(s.url);
  const items = await fromPage(html, s.url);
  for (const link of promoLinks(html, s.url)) {
    await sleep(1000);
    try {
      items.push(...(await fromPage(await getHtml(link), link)));
    } catch (e) {
      console.log(`   ↳ підсторінка ${link}: ${e.message}`);
    }
  }
  return items;
}

function toRow(it, placeId) {
  if (it.deal) {
    const fullText = `${it.deal.title} ${it.deal.description || ''} ${it.deal.conditions || ''}`;
    if (hasProfanity(fullText) || isBannedPromo(fullText)) return null;

    const guessed = !it.deal.ends_on;
    const ends_on = it.deal.ends_on || addDays(today, 7);

    return {
      place_id: placeId,
      title: it.deal.title,
      description: it.deal.description,
      conditions: it.deal.conditions || (guessed ? 'Дату завершення не вказано: перевірте в закладі' : null),
      days: it.deal.days,
      time_from: it.deal.time_from,
      time_to: it.deal.time_to,
      ends_on,
      source: it.source,
      source_url: it.url,
      approved: true,
      mod_score: 95,
      mod_note: `Groq (${it.deal.category}): ОК`,
      guessed,
    };
  }

  const end = guessEndDate(it.text, today);
  const lines = it.text.split('\n').map(l => l.trim()).filter(Boolean);
  const full = lines.join(' ');
  const firstSentence = full.split(/(?<=[.!?])\s+/)[0] || lines[0] || '';

  const r = {
    title: smartCut(firstSentence, 120),
    description: lines.length > 1 ? smartCut(lines.slice(1).join(' '), 600) : (full.length > 120 ? smartCut(full, 600) : null),
    conditions: null,
    days: [1, 2, 3, 4, 5, 6, 7],
    time_from: null,
    time_to: null,
    ends_on: end.date,
    guessed: end.guessed,
  };

  const mod = scoreDeal({
    title: r.title,
    description: r.description,
    conditions: r.conditions,
    ends_on: r.ends_on,
    today,
  });
  if (mod.verdict === 'reject') return null;

  return {
    place_id: placeId,
    title: r.title,
    description: r.description,
    conditions: r.conditions || (r.guessed ? 'Дату завершення не вказано: перевірте в закладі' : null),
    days: r.days,
    time_from: r.time_from,
    time_to: r.time_to,
    ends_on: r.ends_on,
    source: it.source,
    source_url: it.url,
    approved: mod.verdict === 'ok',
    mod_score: mod.score,
    mod_note: mod.reasons.join('; ') || null,
    guessed: !!r.guessed,
  };
}

for (const s of sources) {
  const label = s.channel || s.url;
  try {
    await sleep(800);
    const pl = s.place_id
      ? { id: s.place_id }
      : (await db.from('places').select('id').eq('name', s.place).maybeSingle()).data;
    if (!pl) {
      console.log(`✗ ${label}: заклад «${s.place}» не знайдено в places`);
      continue;
    }

    const items = await collect(s);
    const parsed = items.map(it => toRow(it, pl.id)).filter(Boolean);
    if (!parsed.length) {
      console.log(`– ${label}: акцій не знайдено`);
      continue;
    }

    const uniqueMap = new Map();
    for (const item of parsed) uniqueMap.set(item.source_url, item);
    const deduped = [...uniqueMap.values()];
    const rows = deduped.map(({ guessed, ...row }) => row);

    const { error } = await db.from('deals').upsert(rows, { onConflict: 'source_url' });

    const again = deduped.filter(r => r.guessed).map(r => r.source_url);
    if (!error && again.length) {
      await db
        .from('deals')
        .update({ ends_on: addDays(today, 7) })
        .in('source_url', again)
        .eq('hidden', false)
        .lt('ends_on', addDays(today, 7));
    }

    console.log(
      error
        ? `✗ ${label}: ${error.message}`
        : `✓ ${label}: ${rows.length} (опубліковано ${rows.filter(r => r.approved).length}, у чернетки ${rows.filter(r => !r.approved).length})`
    );
  } catch (e) {
    failed++;
    console.log(`✗ ${label}: ${e.cause?.code || e.cause?.message || e.message}`);
  }
}

console.log(`\nГотово. Не вдалося відкрити джерел: ${failed} із ${sources.length}. Запитів до Groq: ${llmCalls}`);
