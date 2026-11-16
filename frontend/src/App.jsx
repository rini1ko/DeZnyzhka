import { useEffect, useState, useCallback } from 'react';
import { supabase, api } from './api.js';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const CATS = { coffee: 'Кава', food: 'Обіди' };

function AuthForm({ onDone }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { data, error } = await fn.call(supabase.auth, { email, password });
    if (error) return setMsg(error.message);
    if (mode === 'signup' && !data.session) return setMsg('Перевірте пошту й підтвердьте email, потім увійдіть.');
    onDone();
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>{mode === 'signin' ? 'Вхід' : 'Реєстрація'}</h2>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" placeholder="Пароль (від 6 символів)" minLength={6} value={password}
        onChange={e => setPassword(e.target.value)} required />
      <button className="primary">{mode === 'signin' ? 'Увійти' : 'Створити акаунт'}</button>
      {msg && <p className="note">{msg}</p>}
      <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'Немає акаунта? Зареєструватися' : 'Вже є акаунт? Увійти'}
      </button>
    </form>
  );
}

function DealCard({ deal, user, saved, onChange, needLogin }) {
  const [note, setNote] = useState('');
  const p = deal.place;
  const guard = fn => async (...a) => {
    if (!user) return needLogin();
    try { await fn(...a); } catch (e) { setNote(e.message); }
  };
  const toggleSave = guard(async () => {
    await api(`/api/favorites/${deal.id}`, { method: saved ? 'DELETE' : 'POST', body: {} });
    onChange();
  });
  const vote = guard(async still_valid => {
    const r = await api(`/api/deals/${deal.id}/vote`, { method: 'POST', body: { still_valid } });
    setNote(r.hidden ? 'Дякуємо! Акцію приховано.' : 'Дякуємо за відповідь!');
    if (r.hidden) onChange();
  });
  const when = `${deal.days.length === 7 ? 'щодня' : deal.days.map(d => DAYS[d - 1]).join(', ')}` +
    (deal.time_from ? `, ${deal.time_from.slice(0, 5)}–${deal.time_to?.slice(0, 5) || '…'}` : '');
  return (
    <article className="deal">
      <div className="deal-top">
        <span className={`tag ${p.category}`}>{CATS[p.category]}</span>
        <button className={`heart ${saved ? 'on' : ''}`} onClick={toggleSave}
          aria-label={saved ? 'Прибрати з вибраного' : 'У вибране'}>{saved ? '♥' : '♡'}</button>
      </div>
      <h3>{deal.title}</h3>
      <p className="place">{p.name}</p>
      {deal.description && <p>{deal.description}</p>}
      <dl>
        <dt>Коли</dt><dd>{when}</dd>
        <dt>До</dt><dd>{new Date(deal.ends_on).toLocaleDateString('uk-UA')}</dd>
        {deal.conditions && <><dt>Умови</dt><dd>{deal.conditions}</dd></>}
        {p.address && <><dt>Адреса</dt><dd>{p.address}</dd></>}
      </dl>
      <div className="deal-bottom">
        <span className="links">
          {p.instagram && <a href={p.instagram} target="_blank" rel="noreferrer">Instagram</a>}
          {deal.source_url && <a href={deal.source_url} target="_blank" rel="noreferrer">Джерело</a>}
        </span>
        <span className="vote">Ще діє?
          <button onClick={() => vote(true)}>Так</button>
          <button onClick={() => vote(false)}>Ні</button>
        </span>
      </div>
      {note && <p className="note">{note}</p>}
    </article>
  );
}

function AddDealForm({ places, onDone }) {
  const [f, setF] = useState({ place_id: '', title: '', description: '', conditions: '', days: [1,2,3,4,5,6,7], time_from: '', time_to: '', ends_on: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const toggleDay = d => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort());
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { await api('/api/deals', { method: 'POST', body: f }); onDone(); } catch (e) { setErr(e.message); }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>Додати акцію</h2>
      <select required value={f.place_id} onChange={e => set('place_id', e.target.value)}>
        <option value="">Оберіть заклад</option>
        {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input placeholder="Назва акції, напр. −20% на капучино" required value={f.title} onChange={e => set('title', e.target.value)} />
      <textarea placeholder="Опис" value={f.description} onChange={e => set('description', e.target.value)} />
      <input placeholder="Умови" value={f.conditions} onChange={e => set('conditions', e.target.value)} />
      <div className="days">{DAYS.map((n, i) =>
        <label key={n} className={f.days.includes(i + 1) ? 'on' : ''}>
          <input type="checkbox" checked={f.days.includes(i + 1)} onChange={() => toggleDay(i + 1)} />{n}
        </label>)}
      </div>
      <div className="row">
        <label>З <input type="time" value={f.time_from} onChange={e => set('time_from', e.target.value)} /></label>
        <label>До <input type="time" value={f.time_to} onChange={e => set('time_to', e.target.value)} /></label>
      </div>
      <label>Акція діє до (обов’язково)
        <input type="date" required value={f.ends_on} onChange={e => set('ends_on', e.target.value)} />
      </label>
      {err && <p className="note err">{err}</p>}
      <button className="primary">Опублікувати</button>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('feed'); // feed | favs | add | auth
  const [filters, setFilters] = useState({ category: '', day: '', now: false });
  const [deals, setDeals] = useState([]);
  const [favs, setFavs] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadDeals = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    const q = new URLSearchParams();
    if (filters.category) q.set('category', filters.category);
    if (filters.day) q.set('day', filters.day);
    if (filters.now) q.set('now', '1');
    try { setDeals(await api('/api/deals?' + q)); }
    catch { setError('Не вдалося завантажити. Сервер може прокидатися — спробуйте за хвилину.'); }
    setLoading(false);
  }, [filters]);
  const loadFavs = useCallback(async () => {
    if (!user) return setFavs([]);
    try { setFavs(await api('/api/favorites')); } catch {}
  }, [user]);

  useEffect(() => { loadDeals(); }, [loadDeals]);
  useEffect(() => { loadFavs(); }, [loadFavs]);
  useEffect(() => { api('/api/places').then(setPlaces).catch(() => {}); }, []);

  const savedIds = new Set(favs.map(f => f.deal.id));
  const refresh = () => { loadDeals(true); loadFavs(); };
  const list = view === 'favs' ? favs.map(f => f.deal) : deals;

  return (
    <div className="app">
      <header>
        <h1 onClick={() => setView('feed')}>DeЗнижка</h1>
        <nav>
          <button onClick={() => setView('feed')} className={view === 'feed' ? 'on' : ''}>Знижки</button>
          <button onClick={() => user ? setView('favs') : setView('auth')} className={view === 'favs' ? 'on' : ''}>Вибране</button>
          <button onClick={() => user ? setView('add') : setView('auth')} className={view === 'add' ? 'on' : ''}>Додати акцію</button>
          {user
            ? <button onClick={() => { supabase.auth.signOut(); setView('feed'); }}>Вийти</button>
            : <button className="primary" onClick={() => setView('auth')}>Увійти</button>}
        </nav>
      </header>

      {view === 'auth' && !user && <AuthForm onDone={() => setView('feed')} />}
      {view === 'add' && user && <AddDealForm places={places} onDone={() => { refresh(); setView('feed'); }} />}

      {(view === 'feed' || view === 'favs') && (
        <>
          {view === 'feed' && (
            <div className="filters">
              <button className={!filters.category ? 'on' : ''} onClick={() => setFilters(f => ({ ...f, category: '' }))}>Усе</button>
              {Object.entries(CATS).map(([k, v]) =>
                <button key={k} className={filters.category === k ? 'on' : ''} onClick={() => setFilters(f => ({ ...f, category: k }))}>{v}</button>)}
              <button className={filters.now ? 'on now' : 'now'} onClick={() => setFilters(f => ({ ...f, now: !f.now }))}>Діє зараз</button>
              <select value={filters.day} onChange={e => setFilters(f => ({ ...f, day: e.target.value }))} aria-label="День тижня">
                <option value="">Будь-який день</option>
                {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </div>
          )}
          {loading && deals.length === 0 && view === 'feed' && <p className="empty">Завантажуємо знижки…</p>}
          {error && <p className="empty err">{error}</p>}
          {!loading && !error && list.length === 0 &&
            <p className="empty">{view === 'favs' ? 'Натисніть ♡ на знижці, і вона з’явиться тут.' : 'Нічого не знайшли. Приберіть фільтри або додайте акцію.'}</p>}
          <div className="grid">
            {list.map(d => <DealCard key={d.id} deal={d} user={user} saved={savedIds.has(d.id)}
              onChange={refresh} needLogin={() => setView('auth')} />)}
          </div>
        </>
      )}
    </div>
  );
}
