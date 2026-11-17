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
