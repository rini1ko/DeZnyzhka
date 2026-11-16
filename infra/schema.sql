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
