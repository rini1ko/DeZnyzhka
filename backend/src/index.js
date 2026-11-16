import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

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
  res.json(list);
});

app.post('/api/deals', auth, async (req, res) => {
  const { place_id, title, description, conditions, days, time_from, time_to, ends_on } = req.body;
  if (!place_id || !title?.trim()) return res.status(400).json({ error: 'Вкажіть заклад і назву акції' });
  if (!ends_on) return res.status(400).json({ error: 'Дата завершення обов’язкова' });
  if (ends_on < lvivNow().date) return res.status(400).json({ error: 'Дата завершення вже минула' });
  const { data, error } = await db.from('deals').insert({
    place_id, title: title.trim(), description, conditions,
    days: days?.length ? days : [1, 2, 3, 4, 5, 6, 7],
    time_from: time_from || null, time_to: time_to || null, ends_on, created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
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
  res.json(data.filter(f => f.deal && !f.deal.hidden));
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
