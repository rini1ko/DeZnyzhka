import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { scoreDeal, hasProfanity } from './moderation.js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, FRONTEND_ORIGIN = '*', PORT = 3000 } = process.env;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN.split(',') }));
app.use(express.json());

const NO_VOTES_TO_HIDE = 3;

// Час у Львові: { date: 'YYYY-MM-DD', day: 1..7, time: 'HH:MM' }
function lvivNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  const day = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, day, time: `${p.hour}:${p.minute}` };
}

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Потрібно увійти' });
  req.user = data.user;
  next();
}

// Необов'язкова авторизація: гість отримує null, увійшовши користувач — свій об'єкт
async function optionalUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user ?? null;
}
// id акцій, які ця людина позначила як недійсні
async function dismissedIds(userId) {
  const { data } = await db.from('votes').select('deal_id').eq('user_id', userId).eq('still_valid', false);
  return new Set((data || []).map(x => x.deal_id));
}

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/places', async (_, res) => {
  const { data, error } = await db.from('places').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ?category=coffee|food  &day=1..7  &now=1 (діє зараз)  &today=1 (діє сьогодні)
app.get('/api/deals', async (req, res) => {
  const { category, day, now, today } = req.query;
  const n = lvivNow();
  const me = await optionalUser(req);
  const { data, error } = await db.from('deals')
    .select('*, place:places(*)')
    .eq('hidden', false)
    .eq('approved', true)               // імпортовані чернетки чекають перевірки
    .gte('ends_on', n.date)             // прострочені не показуємо
    .order('ends_on');
  if (error) return res.status(500).json({ error: error.message });

  let list = data;
  if (category) list = list.filter(d => d.place?.category === category);
  if (day) list = list.filter(d => d.days.includes(Number(day)));
  if (today) list = list.filter(d => d.days.includes(n.day));
  if (now) list = list.filter(d =>
    d.days.includes(n.day) &&
    (!d.time_from || d.time_from.slice(0, 5) <= n.time) &&
    (!d.time_to || d.time_to.slice(0, 5) >= n.time));
  if (me) {                                   // що людина визнала недійсним, їй більше не показуємо
    const gone = await dismissedIds(me.id);
    list = list.filter(d => !gone.has(d.id));
  }
  const ids = list.map(d => d.id);
  if (ids.length) {
    const [{ data: v }, { data: fv }] = await Promise.all([
      db.from('votes').select('deal_id').eq('still_valid', true).in('deal_id', ids),
      db.from('favorites').select('deal_id').in('deal_id', ids),
    ]);
    const conf = {}, likes = {};
    (v || []).forEach(x => { conf[x.deal_id] = (conf[x.deal_id] || 0) + 1; });
    (fv || []).forEach(x => { likes[x.deal_id] = (likes[x.deal_id] || 0) + 1; });
    list = list.map(d => ({ ...d, confirmations: conf[d.id] || 0, likes: likes[d.id] || 0 }))
      .sort((a, b) => b.likes - a.likes || a.ends_on.localeCompare(b.ends_on));   // найзалайканіші зверху
  }
  res.json(list);
});

app.post('/api/deals', auth, async (req, res) => {
  const { place_id, title, description, conditions, days, time_from, time_to, ends_on } = req.body;
  const n = lvivNow();
  if (!place_id || !title?.trim()) return res.status(400).json({ error: 'Вкажіть заклад і назву акції' });
  if (!ends_on) return res.status(400).json({ error: 'Дата завершення обов’язкова' });
  if (ends_on < n.date) return res.status(400).json({ error: 'Дата завершення вже минула' });

  const mod = scoreDeal({ title, description, conditions, ends_on, today: n.date });
  if (mod.verdict === 'reject')
    return res.status(422).json({ error: `Акцію не прийнято: ${mod.reasons.join('; ') || 'низька якість опису'}.` });

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count: recent } = await db.from('deals').select('*', { count: 'exact', head: true })
    .eq('created_by', req.user.id).gte('created_at', since);
  if ((recent || 0) >= 5) return res.status(429).json({ error: 'Забагато акцій за добу. Спробуйте завтра.' });

  const { data: dup } = await db.from('deals').select('id').eq('place_id', place_id)
    .ilike('title', title.trim().replace(/[%_]/g, '\\$&')).gte('ends_on', n.date).limit(1);
  if (dup?.length) return res.status(409).json({ error: 'Така акція в цьому закладі вже є' });

  const approved = mod.verdict === 'ok';   // сумнівні (review) чекають ручної перевірки
  const { data, error } = await db.from('deals').insert({
    place_id, title: title.trim(), description, conditions,
    days: days?.length ? days : [1, 2, 3, 4, 5, 6, 7],
    time_from: time_from || null, time_to: time_to || null, ends_on, created_by: req.user.id,
    source: 'user', approved, mod_score: mod.score, mod_note: mod.reasons.join('; ') || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ...data, pending: !approved });
});

// Заявка на новий заклад (додається в places після схвалення в Supabase)
app.post('/api/place-requests', auth, async (req, res) => {
  const { name, category, address, instagram } = req.body;
  const nm = (name || '').trim();
  if (nm.length < 2 || nm.length > 80) return res.status(400).json({ error: 'Вкажіть назву закладу (2–80 символів)' });
  if (!['coffee', 'food'].includes(category)) return res.status(400).json({ error: 'Оберіть категорію' });
  if (hasProfanity(`${nm} ${address || ''}`)) return res.status(422).json({ error: 'Заявку не прийнято' });
  const { data: ex } = await db.from('places').select('id').ilike('name', nm.replace(/[%_]/g, '\\$&')).limit(1);
  if (ex?.length) return res.status(409).json({ error: 'Такий заклад уже є в списку' });
  const { count } = await db.from('place_requests').select('*', { count: 'exact', head: true })
    .eq('requested_by', req.user.id).eq('status', 'pending');
  if ((count || 0) >= 3) return res.status(429).json({ error: 'У вас уже є 3 заявки на розгляді' });
  const { error } = await db.from('place_requests')
    .insert({ name: nm, category, address, instagram, requested_by: req.user.id });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true });
});

// "Ще діє? Так / Ні": 3 голоси "ні" -> акція ховається
app.post('/api/deals/:id/vote', auth, async (req, res) => {
  const id = req.params.id;
  const { error } = await db.from('votes')
    .upsert({ deal_id: id, user_id: req.user.id, still_valid: !!req.body.still_valid });
  if (error) return res.status(500).json({ error: error.message });
  const { count } = await db.from('votes').select('*', { count: 'exact', head: true })
    .eq('deal_id', id).eq('still_valid', false);
  const hidden = (count || 0) >= NO_VOTES_TO_HIDE;
  if (hidden) {
    await db.from('deals').update({ hidden: true }).eq('id', id);
    console.log(`Акцію ${id} приховано (${count} голосів «ні») — треба повідомити заклад`);
  }
  res.json({ no_votes: count || 0, hidden });
});

app.get('/api/favorites', auth, async (req, res) => {
  const { data, error } = await db.from('favorites')
    .select('kind, deal:deals(*, place:places(*))').eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  const gone = await dismissedIds(req.user.id);
  res.json(data.filter(f => f.deal && !f.deal.hidden && !gone.has(f.deal.id)));
});

app.post('/api/favorites/:dealId', auth, async (req, res) => {
  const kind = req.body.kind === 'later' ? 'later' : 'favorite';
  const { error } = await db.from('favorites')
    .upsert({ user_id: req.user.id, deal_id: req.params.dealId, kind });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true });
});

app.delete('/api/favorites/:dealId', auth, async (req, res) => {
  await db.from('favorites').delete().eq('user_id', req.user.id).eq('deal_id', req.params.dealId);
  res.json({ ok: true });
});

export default app;
// У Lambda сервер не слухає порт сам: запити приймає src/lambda.js
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) app.listen(PORT, () => console.log(`API on :${PORT}`));
