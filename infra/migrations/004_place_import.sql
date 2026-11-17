-- Для вже створеної бази: Supabase -> SQL Editor -> Run
alter table places add column if not exists website text;
alter table places add column if not exists osm_id text unique;
