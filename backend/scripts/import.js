// Автопошук знижок: сайти закладів (з places.website), Telegram-канали з infra/sources.json.
// Якість ок -> акція публікується одразу з позначкою «знайдено автоматично»; сумнівне -> чернетка (approved=false).
// З GEMINI_API_KEY сторінки читає безкоштовна модель Gemini, без нього працюють прості правила.
// Запуск: cd backend && npm run import   (щодня: .github/workflows/daily-import.yml)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { DEAL_RE, parsePosts, guessEndDate, addDays } from './telegram-parse.js';
import { extractWebLines, htmlToText, promoLinks } from './web-parse.js';
import { extractDealsLLM } from './llm-extract.js';
import { scoreDeal } from '../src/moderation.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const manual = JSON.parse(readFileSync(new URL('../../infra/sources.json', import.meta.url), 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const MAX_AGE_DAYS = 14;
const HEADERS = { 'User-Agent': 'DeZnyzhkaBot/0.1 (student project)' };
const KEY = process.env.GEMINI_API_KEY;
const LLM_MAX = +(process.env.LLM_MAX_CALLS || 80);
let llmCalls = 0, llmOff = !KEY, failed = 0;
const hash = t => createHash('md5').update(t).digest('hex').slice(0, 10);

const { data: withSite } = await db.from('places').select('id, name, website').not('website', 'is', null);
const seen = new Set(manual.map(m => m.url).filter(Boolean));
const auto = (withSite || []).filter(p => !seen.has(p.website)).map(p => ({ url: p.website, place: p.name, place_id: p.id }));
const sources = [...manual, ...auto];

async function getHtml(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fromPage(html, page) {
  const text = htmlToText(html);
  if (!llmOff && llmCalls < LLM_MAX && text.length >= 200) {   // майже порожня сторінка (сайт на JS) не варта запиту
    try {
      llmCalls++; await sleep(6500);                       // безкоштовний тариф: ліміти на хвилину невеликі, тож не поспішаємо
      const deals = await extractDealsLLM(text, { apiKey: KEY, today });
      return deals.map(d => ({ source: 'web', url: `${page}#${hash(d.title + (d.ends_on || ''))}`, deal: d }));
    } catch (e) {
      if (e.message === 'RATE_LIMIT') { llmOff = true; console.log('… ліміт Gemini вичерпано, далі прості правила'); }
      else console.log(`… Gemini: ${e.message}; для цієї сторінки прості правила`);
    }
  }
  return extractWebLines(html).map(t => ({ source: 'web', url: `${page}#${hash(t)}`, text: t }));
}

async function collect(s) {
  if (s.channel) {
    return parsePosts(await getHtml(`https://t.me/s/${s.channel}`))
      .filter(p => DEAL_RE.test(p.text))
      .filter(p => !p.date || (Date.now() - Date.parse(p.date)) / 864e5 <= MAX_AGE_DAYS)
      .map(p => ({ source: 'telegram', url: p.url, text: p.text }));
  }
  if (!s.url) return [];
  const html = await getHtml(s.url);
  const items = await fromPage(html, s.url);
  for (const link of promoLinks(html, s.url)) {            // сторінки «Акції» знаходимо самі
    await sleep(1000);
    try { items.push(...await fromPage(await getHtml(link), link)); } catch {}
  }
  return items;
}

function toRow(it, placeId) {
  let r;
  if (it.deal) {
    r = { ...it.deal, ends_on: it.deal.ends_on || addDays(today, 7), guessed: !it.deal.ends_on };
  } else {
    const end = guessEndDate(it.text, today);
    const [first, ...rest] = it.text.split('\n').filter(Boolean);
    r = { title: first.slice(0, 80), description: (rest.join(' ') || (first.length > 80 ? first : '')).slice(0, 300) || null,
      conditions: null, days: [1, 2, 3, 4, 5, 6, 7], time_from: null, time_to: null, ends_on: end.date, guessed: end.guessed };
  }
  const mod = scoreDeal({ title: r.title, description: r.description, conditions: r.conditions, ends_on: r.ends_on, today });
  if (mod.verdict === 'reject') return null;
  return {
    place_id: placeId, title: r.title, description: r.description,
    conditions: r.conditions || (r.guessed ? 'Дату завершення не вказано: перевірте в закладі' : null),
    days: r.days, time_from: r.time_from, time_to: r.time_to, ends_on: r.ends_on,
    source: it.source, source_url: it.url,
    approved: mod.verdict === 'ok',                        // джерело — сам заклад, якість ок -> публікуємо
    mod_score: mod.score, mod_note: mod.reasons.join('; ') || null,
    guessed: !!r.guessed,                                  // службове поле, у базу не йде
  };
}

for (const s of sources) {
  const label = s.channel || s.url;
  try {
    await sleep(1000);
    const pl = s.place_id ? { id: s.place_id } : (await db.from('places').select('id').eq('name', s.place).maybeSingle()).data;
    if (!pl) { console.log(`✗ ${label}: заклад «${s.place}» не знайдено в places`); continue; }
    const items = await collect(s);
    const parsed = items.map(it => toRow(it, pl.id)).filter(Boolean);
    if (!parsed.length) { console.log(`– ${label}: акцій не знайдено`); continue; }
    const rows = parsed.map(({ guessed, ...row }) => row);
    const { error } = await db.from('deals').upsert(rows, { onConflict: 'source_url', ignoreDuplicates: true });
    // Акція без дати завершення бачиться знову -> заклад її ще тримає, тож продовжуємо ще на 7 днів
    // (інакше вона зникла б через тиждень і більше не додалась, бо дубль ігнорується). Приховані голосами не чіпаємо.
    const again = parsed.filter(r => r.guessed).map(r => r.source_url);
    if (!error && again.length) await db.from('deals').update({ ends_on: addDays(today, 7) })
      .in('source_url', again).eq('hidden', false).lt('ends_on', addDays(today, 7));
    console.log(error ? `✗ ${label}: ${error.message}`
      : `✓ ${label}: ${rows.length} (опубліковано ${rows.filter(r => r.approved).length}, у чернетки ${rows.filter(r => !r.approved).length})`);
  } catch (e) {
    failed++;
    console.log(`✗ ${label}: ${e.cause?.code || e.cause?.message || e.message}`);
  }
}
console.log(`\nГотово. Не вдалося відкрити джерел: ${failed} із ${sources.length}. Запитів до Gemini: ${llmCalls}`);
