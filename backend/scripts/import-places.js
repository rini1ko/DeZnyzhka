// Автозаповнення таблиці places закладами Львова з OpenStreetMap.
// Запуск: cd backend && npm run import:places
import { createClient } from '@supabase/supabase-js';
import { toPlace } from './osm-parse.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const [LAT, LON, RADIUS, LIMIT] = [49.8419, 24.0315, 4500, 250];

const query = `[out:json][timeout:60];nwr["amenity"~"^(cafe|restaurant|fast_food|bakery|bar|pub)$"]["name"](around:${RADIUS},${LAT},${LON});out center tags;`;
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function runQuery() {
  for (let round = 0; round < 3; round++) {
    for (const url of MIRRORS) {
      const host = new URL(url).host;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DeZnyzhkaBot/0.1 (student project)' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(90000),
        });
        if (res.ok) return await res.json();
        console.log(`… ${host}: HTTP ${res.status}, пробую інший сервер`);
      } catch (e) {
        console.log(`… ${host}: ${e.message}, пробую інший сервер`);
      }
    }
    if (round < 2) {
      console.log('Усі сервери зайняті, чекаю 20 секунд і пробую ще раз…');
      await new Promise(r => setTimeout(r, 20000));
    }
  }
  return null;
}

const data = await runQuery();
if (!data) {
  console.log('✗ Overpass недоступний. Спробуйте за кілька хвилин.');
  process.exit(1);
}

const found = data.elements.map(toPlace).filter(Boolean);
const score = p => (p.website ? 2 : 0) + (p.instagram ? 1 : 0);
const rows = found.sort((a, b) => score(b) - score(a)).slice(0, LIMIT);

const { data: existing } = await db.from('places').select('osm_id');
const have = new Set((existing || []).map(p => p.osm_id).filter(Boolean));
const fresh = rows.filter(p => !have.has(p.osm_id));

const { error } = await db.from('places').upsert(fresh, { onConflict: 'osm_id', ignoreDuplicates: true });
console.log(
  error
    ? `✗ ${error.message}`
    : `✓ Знайдено ${found.length}, додано ${fresh.length} (із сайтом: ${fresh.filter(p => p.website).length})`
);