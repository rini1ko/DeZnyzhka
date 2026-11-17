// Автозаповнення таблиці places закладами Львова з OpenStreetMap.
import { createClient } from '@supabase/supabase-js';
import { toPlace } from './osm-parse.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const [LAT, LON, RADIUS, LIMIT] = [49.8419, 24.0315, 3500, 250];

// Таймаут самого запиту Overpass — 25 секунд
const query = `[out:json][timeout:25];nwr["amenity"~"^(cafe|restaurant|fast_food|bakery|bar|pub)$"]["name"](around:${RADIUS},${LAT},${LON});out center tags;`;

// Тільки європейські дзеркала (Німеччина, Швейцарія)
const MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function runQuery() {
  for (let round = 0; round < 2; round++) {
    for (const url of MIRRORS) {
      const host = new URL(url).host;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DeZnyzhkaBot/0.1 (student project)' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(25000), // чекаємо відповідь максимум 25 секунд
        });
        if (res.ok) return await res.json();
        console.log(`… ${host}: HTTP ${res.status}, пробую інший сервер`);
      } catch (e) {
        console.log(`… ${host}: ${e.message}, пробую інший сервер`);
      }
    }
    if (round < 1) {
      console.log('Усі сервери зайняті, чекаю 10 секунд і пробую ще раз…');
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  return null;
}

const data = await runQuery();
if (!data) {
  console.log('⚠ Overpass тимчасово недоступний, пропускаю оновлення закладів.');
  process.exit(0); // виходимо без помилки, щоб воркфлоу йшов далі
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
