// Імпорт знижок з публічних Telegram-каналів закладів у таблицю deals (approved=false).
// Запуск: cd backend && node --env-file=.env scripts/import-telegram.js
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { DEAL_RE, parsePosts, guessEndDate } from './telegram-parse.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sources = JSON.parse(readFileSync(new URL('../../infra/sources.json', import.meta.url), 'utf-8'));
const today = new Date().toISOString().slice(0, 10);
const MAX_AGE_DAYS = 14;

for (const { channel, place } of sources) {
  const { data: pl } = await db.from('places').select('id').eq('name', place).maybeSingle();
  if (!pl) { console.log(`✗ ${channel}: заклад «${place}» не знайдено в таблиці places`); continue; }

  const res = await fetch(`https://t.me/s/${channel}`, { headers: { 'User-Agent': 'DeZnyzhkaBot/0.1 (student project)' } });
  if (!res.ok) { console.log(`✗ ${channel}: HTTP ${res.status}`); continue; }

  const rows = parsePosts(await res.text())
    .filter(p => DEAL_RE.test(p.text))
    .filter(p => !p.date || (Date.now() - Date.parse(p.date)) / 864e5 <= MAX_AGE_DAYS)
    .map(p => {
      const end = guessEndDate(p.text, today);
      const [first, ...rest] = p.text.split('\n').filter(Boolean);
      return {
        place_id: pl.id, title: first.slice(0, 80), description: rest.join(' ').slice(0, 300) || null,
        conditions: end.guessed ? 'Дату завершення не вказано — перевірте' : null,
        ends_on: end.date, source: 'telegram', source_url: p.url, approved: false,
      };
    });

  if (!rows.length) { console.log(`– ${channel}: свіжих постів про знижки немає`); continue; }
  const { error } = await db.from('deals').upsert(rows, { onConflict: 'source_url', ignoreDuplicates: true });
  console.log(error ? `✗ ${channel}: ${error.message}` : `✓ ${channel}: знайдено ${rows.length} (нові чекають перевірки)`);
}
