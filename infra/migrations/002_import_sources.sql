-- Для вже створеної бази: Supabase -> SQL Editor -> Run
alter table deals add column if not exists source text not null default 'manual';
alter table deals add column if not exists source_url text unique;
alter table deals add column if not exists approved boolean not null default true;
