import { useEffect, useState, useCallback } from 'react';
import { supabase, api } from './api.js';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const CATS = { coffee: 'Кава', food: 'Обіди' };
const SRC = {
  user: ['Додано користувачем', 'warn', 'Не перевірено командою: уточніть умови в закладі'],
  telegram: ['З Telegram закладу', 'info', 'Знайдено автоматично, не перевірено командою'],
  web: ['З сайту закладу', 'info', 'Знайдено автоматично, не перевірено командою'],
  manual: ['Від команди', 'ok', 'Внесено командою DeЗнижка'],
};
// Відкриває Google Maps (на телефоні одразу застосунок). Без адреси шукаємо за координатами, інакше за назвою.
const mapsUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(
  !p.address && p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : [p.name, p.address, 'Львів'].filter(Boolean).join(', '));

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

function DealCard({ deal, user, saved, hot, onChange, onInvalid, needLogin }) {
  const [note, setNote] = useState('');
  const p = deal.place;
  const src = SRC[deal.source];
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
    if (!still_valid || r.hidden) return onInvalid(deal.id);   // недійсну більше не показуємо
    setNote('Дякуємо за відповідь!');
  });
  const when = `${deal.days.length === 7 ? 'щодня' : deal.days.map(d => DAYS[d - 1]).join(', ')}` +
    (deal.time_from ? `, ${deal.time_from.slice(0, 5)}–${deal.time_to?.slice(0, 5) || '…'}` : '');
  return (
    <article className="deal">
      <div className="deal-top">
        <span className="tags">
          <span className={`tag ${p.category}`}>{CATS[p.category]}</span>
          {hot && <span className="badge hot">🔥 Популярне</span>}
          {src && <span className={`badge ${src[1]}`} title={src[2]}>{src[0]}</span>}
        </span>
        <span className="hearts">
          <button className={`heart ${saved ? 'on' : ''}`} onClick={toggleSave}
            aria-label={saved ? 'Прибрати з вибраного' : 'У вибране'}>{saved ? '♥' : '♡'}</button>
          <span className="likes" title="Скільком людям сподобалось">{deal.likes || 0}</span>
        </span>
      </div>
      <h3>{deal.title}</h3>
      <p className="place">{p.name}</p>
      {deal.description && <p>{deal.description}</p>}
      <dl>
        <dt>Коли</dt><dd>{when}</dd>
        <dt>До</dt><dd>{new Date(deal.ends_on).toLocaleDateString('uk-UA')}</dd>
        {deal.conditions && <><dt>Умови</dt><dd>{deal.conditions}</dd></>}
        <dt>Адреса</dt><dd>{p.address ? `${p.address} ` : ''}
          <a className="maplink" href={mapsUrl(p)} target="_blank" rel="noreferrer">На карті ↗</a></dd>
      </dl>
      {['user', 'telegram', 'web'].includes(deal.source) && <p className="note warn">⚠ {deal.source === 'user' ? 'Додано користувачем' : 'Знайдено автоматично'}. Перевірте умови в закладі.</p>}
      {deal.confirmations > 0 && <p className="note">✓ Підтвердили, що діє: {deal.confirmations}</p>}
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

function AddDealForm({ places, onDone, onRequest }) {
  const [f, setF] = useState({ place_id: '', title: '', description: '', conditions: '', days: [1,2,3,4,5,6,7], time_from: '', time_to: '', ends_on: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const toggleDay = d => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort());
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/deals', { method: 'POST', body: f }); onDone(r.pending); } catch (e) { setErr(e.message); }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>Додати акцію</h2>
      <select required value={f.place_id} onChange={e => set('place_id', e.target.value)}>
        <option value="">Оберіть заклад</option>
        {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" className="link" onClick={onRequest}>Немає закладу в списку? Подати заявку</button>
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

function Home({ user, count, go, pick }) {
  return (
    <section className="home">
      <p className="kicker">Львів · центр · студентам</p>
      <h2 className="hero">Де сьогодні вигідно випити кави чи пообідати?</h2>
      <p className="lead">Усі знижки кав’ярень і ресторанів в одному місці. Без десятка сторінок в Instagram.</p>
      <div className="cta">
        <button className="primary big" onClick={() => pick({})}>Дивитись знижки</button>
        {!user && <button className="big" onClick={() => go('auth')}>Увійти / Зареєструватись</button>}
      </div>
      <p className="note">{user
        ? 'Ви увійшли: можна зберігати акції у вибране й додавати нові.'
        : 'Реєстрація не обов’язкова: дивитись знижки можна як гість. Вхід потрібен, щоб зберігати ♡, голосувати й додавати акції.'}</p>
      <div className="tiles">
        <button className="tile" onClick={() => pick({ now: true })}><b>Діє зараз</b><span>акції, що працюють просто зараз</span></button>
        <button className="tile" onClick={() => pick({ category: 'coffee' })}><b>Кава</b><span>кав’ярні центру</span></button>
        <button className="tile" onClick={() => pick({ category: 'food' })}><b>Обіди</b><span>ланчі й ресторани</span></button>
      </div>
      {count > 0 && <p className="count">Зараз на сайті: {count} акцій</p>}
    </section>
  );
}

function PlaceRequestForm({ onDone, onBack }) {
  const [f, setF] = useState({ name: '', category: 'coffee', address: '', instagram: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { await api('/api/place-requests', { method: 'POST', body: f }); onDone(); } catch (e) { setErr(e.message); }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>Заявка на новий заклад</h2>
      <p className="note">Заклад з’явиться у списку після перевірки командою.</p>
      <input placeholder="Назва закладу" required value={f.name} onChange={e => set('name', e.target.value)} />
      <select value={f.category} onChange={e => set('category', e.target.value)}>
        <option value="coffee">Кава</option><option value="food">Обіди / ресторан</option>
      </select>
      <input placeholder="Адреса" value={f.address} onChange={e => set('address', e.target.value)} />
      <input placeholder="Instagram (посилання)" value={f.instagram} onChange={e => set('instagram', e.target.value)} />
      {err && <p className="note err">{err}</p>}
      <button className="primary">Надіслати заявку</button>
      <button type="button" className="link" onClick={onBack}>Назад до додавання акції</button>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // home | feed | favs | add | auth
  const [filters, setFilters] = useState({ category: '', day: '', now: false });
  const [deals, setDeals] = useState([]);
  const [favs, setFavs] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

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
    try {
      const fresh = await api('/api/deals?' + q);
      // тихе оновлення (після лайка) не міняє порядок карток, щоб вони не стрибали
      setDeals(prev => {
        if (!silent) return fresh;
        const pos = new Map(prev.map((d, i) => [d.id, i]));
        return [...fresh].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
      });
    }
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
  const hotIds = new Set([...deals].sort((a, b) => b.likes - a.likes).filter(d => d.likes > 0).slice(0, 3).map(d => d.id));
  const onInvalid = id => {
    setDeals(d => d.filter(x => x.id !== id));
    setFavs(f => f.filter(x => x.deal.id !== id));
    setFlash('Дякуємо! Ми більше не показуватимемо вам цю акцію.');
  };
  const refresh = () => { loadDeals(true); loadFavs(); };
  const list = view === 'favs' ? favs.map(f => f.deal) : deals;

  return (
    <div className="app">
      <header>
        <h1 onClick={() => setView('home')}>DeЗнижка</h1>
        <nav>
          <button onClick={() => setView('home')} className={view === 'home' ? 'on' : ''}>Головна</button>
          <button onClick={() => setView('feed')} className={view === 'feed' ? 'on' : ''}>Знижки</button>
          <button onClick={() => user ? setView('favs') : setView('auth')} className={view === 'favs' ? 'on' : ''}>Вибране</button>
          <button onClick={() => user ? setView('add') : setView('auth')} className={view === 'add' ? 'on' : ''}>Додати акцію</button>
          {user
            ? <button onClick={() => { supabase.auth.signOut(); setView('home'); }}>Вийти</button>
            : <button className="primary" onClick={() => setView('auth')}>Увійти</button>}
        </nav>
      </header>

      {flash && <p className="flash" onClick={() => setFlash('')}>{flash} ✕</p>}

      {view === 'home' && <Home user={user} count={deals.length} go={setView}
        pick={f => { setFilters({ category: '', day: '', now: false, ...f }); setView('feed'); }} />}

      {view === 'auth' && !user && <AuthForm onDone={() => setView('feed')} />}
      {view === 'add' && user && <AddDealForm places={places} onRequest={() => setView('request')}
        onDone={pending => {
          refresh(); setView('feed');
          setFlash(pending ? 'Акцію надіслано на перевірку: вона з’явиться після схвалення.' : 'Акцію додано!');
        }} />}
      {view === 'request' && user && <PlaceRequestForm onBack={() => setView('add')}
        onDone={() => { setFlash('Заявку надіслано! Заклад з’явиться у списку після перевірки.'); setView('add'); }} />}

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
            {list.map(d => <DealCard key={d.id} deal={d} user={user} saved={savedIds.has(d.id)} hot={hotIds.has(d.id)}
              onInvalid={onInvalid} onChange={refresh} needLogin={() => setView('auth')} />)}
          </div>
        </>
      )}
    </div>
  );
}
