-- Запусти в Supabase: SQL Editor -> New query -> Run
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('coffee','food')),
  address text,
  district text default 'Центр',
  instagram text,
  lat double precision,
  lng double precision
);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  title text not null,
  description text,
  conditions text,
  days int[] not null default '{1,2,3,4,5,6,7}',  -- 1=Пн ... 7=Нд
  time_from time,
  time_to time,
  ends_on date not null,                           -- дата завершення обов'язкова
  hidden boolean not null default false,
  source text not null default 'manual',           -- manual | telegram
  source_url text unique,                          -- пост-першоджерело (для імпорту)
  approved boolean not null default true,          -- імпорт створює approved=false
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists votes (
  deal_id uuid references deals(id) on delete cascade,
  user_id uuid not null,
  still_valid boolean not null,
  primary key (deal_id, user_id)
);

create table if not exists favorites (
  user_id uuid not null,
  deal_id uuid references deals(id) on delete cascade,
  kind text not null default 'favorite' check (kind in ('favorite','later')),
  primary key (user_id, deal_id)
);

-- Доступ лише через backend (service key); напряму з браузера таблиці закриті
alter table places enable row level security;
alter table deals enable row level security;
alter table votes enable row level security;
alter table favorites enable row level security;

-- ===== модерація та заявки на заклади =====
-- Для вже створеної бази: Supabase -> SQL Editor -> Run
-- (старі акції, додані через форму, мали source='manual'; за потреби: update deals set source='user' where id in (...);)
alter table deals add column if not exists mod_score int;
alter table deals add column if not exists mod_note text;

create table if not exists place_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('coffee','food')),
  address text,
  instagram text,
  requested_by uuid,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  place_id uuid references places(id),
  created_at timestamptz not null default now()
);
alter table place_requests enable row level security;

-- Коли в Table Editor ставите status='approved', заклад автоматично з'являється в places
create or replace function approve_place_request() returns trigger language plpgsql as $$
declare new_id uuid;
begin
  if new.status = 'approved' and old.status <> 'approved' and new.place_id is null then
    insert into places (name, category, address, instagram)
      values (new.name, new.category, new.address, new.instagram) returning id into new_id;
    new.place_id := new_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_approve_place_request on place_requests;
create trigger trg_approve_place_request before update on place_requests
  for each row execute function approve_place_request();

-- ===== автозаповнення закладів =====
-- Для вже створеної бази: Supabase -> SQL Editor -> Run
alter table places add column if not exists website text;
alter table places add column if not exists osm_id text unique;
