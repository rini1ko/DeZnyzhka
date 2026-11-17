// Перетворює об'єкт OpenStreetMap (Overpass) на рядок для таблиці places.
const url = v => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

export function toPlace(el) {
  const t = el.tags || {};
  const name = (t['name:uk'] || t.name || '').trim();
  if (!name || !['cafe', 'restaurant', 'fast_food'].includes(t.amenity)) return null;
  const site = t.website || t['contact:website'];
  const ig = t.instagram || t['contact:instagram'];
  const street = t['addr:street'], house = t['addr:housenumber'];
  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    category: t.amenity === 'cafe' ? 'coffee' : 'food',
    address: street ? (house ? `${street}, ${house}` : street) : null,
    district: 'Центр',
    website: site ? url(site.trim()) : null,
    instagram: ig ? (/^https?:\/\//i.test(ig) ? ig : `https://instagram.com/${ig.replace(/^@/, '').trim()}`) : null,
    lat: el.lat ?? el.center?.lat ?? null,
    lng: el.lon ?? el.center?.lon ?? null,
  };
}
