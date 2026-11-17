// Автопошук та автомодерація знижок через Gemini.
// Запуск: cd backend && npm run import (щодня: .github/workflows/daily-import.yml)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { DEAL_RE, parsePosts, guessEndDate, addDays } from './telegram-parse.js';
import { extractWebLines, htmlToText, promoLinks } from './web-parse.js';
import { extractDealsLLM } from './llm-extract.js';
import { scoreDeal, hasProfanity } from '../src/moderation.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const manual = JSON.parse(readFileSync(new URL('../../infra/sources.json', import.meta.url), 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const MAX_AGE_DAYS = 14;
const HEADERS = { 'User-Agent': 'DeZnyzhkaBot/0.1 (student project)' };
const KEY = process.env.GEMINI_API_KEY;
// Безкоштовний тариф AI Studio дає ~20 RPD на модель, ставимо запас під 2-3 моделі
const LLM_MAX = +(process.env.LLM_MAX_CALLS || 45);
let llmCalls = 0, llmOff = !KEY, failed = 0;
const hash = t => createHash('md5').update(t).digest('hex').slice(0, 10);

const { data: withSite } = await db
  .from('places')
  .select('id, name, website')
  .not('website', 'is', null);

const seen = new Set(manual.map(m => m.url).filter(Boolean));
const auto = (withSite || [])
  .filter(p => !seen.has(p.website))
  .map(p => ({ url: p.website, place: p.name, place_id: p.id }));
const sources = [...manual, ...auto];

async function getHtml(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fromPage(html, page) {
  const text = htmlToText(html);
  // Викликаємо Gemini ТІЛЬКИ якщо на сторінці є хоча б згадка про знижки/акції/% — це економить денний ліміт запитів
  const hasPromoHints = text.length >= 200 && DEAL_RE.test(text);

  if (!llmOff && llmCalls < LLM_MAX && hasPromoHints) {
    try {
      llmCalls++;
      await sleep(13000); // ~4-5 запитів/хв, щоб не впиратися в ліміт 5 RPM
      const deals = await extractDealsLLM(text, { apiKey: KEY, today });
      return deals.map(d => ({
        source: 'web',
        url: `${page}#${hash(d.title + (d.ends_on || ''))}`,
        deal: d,
      }));
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        llmOff = true;
        console.log('… денний ліміт Gemini вичерпано, далі прості правила');
      } else {
        console.log(`… Gemini: ${e.message}; для цієї сторінки прості правила`);
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
      .filter(p => DEAL_RE.test(p.text))
      .filter(p => !p.date || (Date.now() - Date.parse(p.date)) / 864e5 <= MAX_AGE_DAYS);

    const items = [];
    for (const p of posts) {
      if (!llmOff && llmCalls < LLM_MAX) {
        try {
          llmCalls++;
          await sleep(13000);
          const deals = await extractDealsLLM(p.text, { apiKey: KEY, today });
          for (const d of deals) {
            items.push({ source: 'telegram', url: p.url, deal: d });
          }
          continue;
        } catch (e) {
          if (e.message === 'RATE_LIMIT') llmOff = true;
        }
      }
      items.push({ source: 'telegram', url: p.url, text: p.text });
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
    } catch {}
  }
  return items;
}

function toRow(it, placeId) {
  // 1. Якщо пропозицію витягнув і перевірив Gemini — публікуємо автоматично без ручної модерації
  if (it.deal) {
    const fullText = `${it.deal.title} ${it.deal.description || ''} ${it.deal.conditions || ''}`;
    if (hasProfanity(fullText)) return null;

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
      approved: true, // схвалено Gemini автоматично
      mod_score: 95,
      mod_note: 'Автомодерація Gemini: ОК',
      guessed,
    };
  }

  // 2. Фолбек на прості правила (якщо закінчився ліміт Gemini)
  const end = guessEndDate(it.text, today);
  const [first, ...rest] = it.text.split('\n').filter(Boolean);
  const r = {
    title: first.slice(0, 80),
    description: (rest.join(' ') || (first.length > 80 ? first : '')).slice(0, 300) || null,
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
    await sleep(1000);
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

    // Прибираємо дублі за source_url в межах одного запиту
    const uniqueMap = new Map();
    for (const item of parsed) {
      uniqueMap.set(item.source_url, item);
    }
    const deduped = [...uniqueMap.values()];
    const rows = deduped.map(({ guessed, ...row }) => row);

    // Оновлюємо дані при збігу source_url, щоб актуальні акції не ігнорувалися
    const { error } = await db
      .from('deals')
      .upsert(rows, { onConflict: 'source_url' });

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

console.log(`\nГотово. Не вдалося відкрити джерел: ${failed} із ${sources.length}. Запитів до Gemini: ${llmCalls}`);