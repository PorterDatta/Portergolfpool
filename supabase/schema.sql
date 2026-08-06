-- =====================================================================
-- FedEx Cup Fantasy Pool — full Postgres schema for Supabase
-- Run once in the Supabase SQL editor (SQL Editor -> New query -> paste -> Run).
-- Enforces: no-repeat rule, weekly pick counts, pick locking, scoring.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------------------------------------------------
do $$ begin
  create type user_role as enum ('participant', 'commissioner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type week_status as enum ('upcoming', 'active', 'locked', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type golfer_status as enum ('active', 'cut', 'wd', 'dq', 'finished');
exception when duplicate_object then null; end $$;

-- ---------- PROFILES (extends auth.users) ----------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text unique not null,
  display_name text not null,
  role         user_role not null default 'participant',
  created_at   timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- SEASONS --------------------------------------------------
create table if not exists seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  archived    boolean not null default false,
  tiebreakers text[] not null default array['best_week','earliest_pick'],
  created_at  timestamptz not null default now()
);

-- ---------- WEEKS (the three playoff events) -------------------------
create table if not exists weeks (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons(id) on delete cascade,
  week_number    int  not null check (week_number between 1 and 3),
  name           text not null,
  picks_required int not null,
  status         week_status not null default 'upcoming',
  lock_at        timestamptz,
  event_id       text,
  weight         numeric not null default 1.0,
  unique (season_id, week_number)
);

-- ---------- PARTICIPANTS --------------------------------------------
create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  profile_id  uuid references profiles(id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (season_id, profile_id)
);

-- ---------- GOLFERS --------------------------------------------------
create table if not exists golfers (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,
  full_name    text not null,
  country      text,
  headshot_url text,
  world_rank   int,
  fedex_rank   int
);
create index if not exists idx_golfers_name on golfers using gin (to_tsvector('english', full_name));

-- ---------- PICKS ----------------------------------------------------
create table if not exists picks (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  week_id        uuid not null references weeks(id) on delete cascade,
  golfer_id      uuid not null references golfers(id),
  created_at     timestamptz not null default now(),
  -- NO-REPEAT RULE: a participant can never use the same golfer twice
  unique (participant_id, golfer_id)
);
create index if not exists idx_picks_week on picks(week_id);

-- ---------- GOLFER SCORES (live, per week) ---------------------------
create table if not exists golfer_scores (
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid not null references weeks(id) on delete cascade,
  golfer_id     uuid not null references golfers(id) on delete cascade,
  position      text,
  position_num  int,
  today         int,
  total_to_par  int,
  fedex_points  numeric not null default 0,
  status        golfer_status not null default 'active',
  updated_at    timestamptz not null default now(),
  unique (week_id, golfer_id)
);

-- ---------- WEEKLY SCORES -------------------------------------------
create table if not exists weekly_scores (
  participant_id uuid not null references participants(id) on delete cascade,
  week_id        uuid not null references weeks(id) on delete cascade,
  points         numeric not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (participant_id, week_id)
);

-- ---------- STANDINGS -----------------------------------------------
create table if not exists standings (
  participant_id uuid primary key references participants(id) on delete cascade,
  season_id      uuid not null references seasons(id) on delete cascade,
  week1          numeric not null default 0,
  week2          numeric not null default 0,
  week3          numeric not null default 0,
  total          numeric not null default 0,
  rank           int,
  updated_at     timestamptz not null default now()
);

-- ---------- ANNOUNCEMENTS & AUDIT -----------------------------------
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references seasons(id) on delete cascade,
  message    text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid references profiles(id),
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- HELPER: is the current user a commissioner?
-- =====================================================================
create or replace function is_commissioner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'commissioner');
$$;

-- =====================================================================
-- ENFORCE: pick count per week + locking, at write time
-- =====================================================================
create or replace function enforce_pick_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w weeks%rowtype;
  current_count int;
begin
  select * into w from weeks where id = new.week_id;

  -- block edits when locked (service role / commissioner bypasses)
  if w.status in ('locked','completed') and not is_commissioner() then
    raise exception 'Picks for % are locked', w.name;
  end if;

  -- enforce max picks per week
  select count(*) into current_count
  from picks where participant_id = new.participant_id and week_id = new.week_id;

  if current_count >= w.picks_required then
    raise exception 'Week % allows only % picks', w.name, w.picks_required;
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_pick_rules on picks;
create trigger trg_enforce_pick_rules
  before insert on picks
  for each row execute function enforce_pick_rules();

-- =====================================================================
-- SCORING: recompute weekly_scores + standings for a season
-- weekly points = sum of picked golfers' fedex_points * week weight
-- =====================================================================
create or replace function recompute_standings(p_season_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 1) weekly_scores per participant per week
  insert into weekly_scores (participant_id, week_id, points, updated_at)
  select pa.id, w.id,
         coalesce(sum(gs.fedex_points * w.weight), 0),
         now()
  from participants pa
  join weeks w on w.season_id = pa.season_id
  left join picks pk on pk.participant_id = pa.id and pk.week_id = w.id
  left join golfer_scores gs on gs.week_id = w.id and gs.golfer_id = pk.golfer_id
  where pa.season_id = p_season_id
  group by pa.id, w.id
  on conflict (participant_id, week_id)
  do update set points = excluded.points, updated_at = now();

  -- 2) standings (pivot the three weeks into columns)
  insert into standings (participant_id, season_id, week1, week2, week3, total, updated_at)
  select pa.id, pa.season_id,
    coalesce(sum(case when w.week_number = 1 then ws.points end), 0),
    coalesce(sum(case when w.week_number = 2 then ws.points end), 0),
    coalesce(sum(case when w.week_number = 3 then ws.points end), 0),
    coalesce(sum(ws.points), 0),
    now()
  from participants pa
  left join weekly_scores ws on ws.participant_id = pa.id
  left join weeks w on w.id = ws.week_id
  where pa.season_id = p_season_id
  group by pa.id, pa.season_id
  on conflict (participant_id)
  do update set week1 = excluded.week1, week2 = excluded.week2,
                week3 = excluded.week3, total = excluded.total, updated_at = now();

  -- 3) rank (highest total first; tie-break by best single week)
  with ranked as (
    select participant_id,
           rank() over (
             order by total desc,
                      greatest(week1, week2, week3) desc
           ) as rnk
    from standings where season_id = p_season_id
  )
  update standings s set rank = r.rnk
  from ranked r where r.participant_id = s.participant_id;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table profiles       enable row level security;
alter table seasons        enable row level security;
alter table weeks          enable row level security;
alter table participants   enable row level security;
alter table golfers        enable row level security;
alter table picks          enable row level security;
alter table golfer_scores  enable row level security;
alter table weekly_scores  enable row level security;
alter table standings      enable row level security;
alter table announcements  enable row level security;
alter table audit_log      enable row level security;

-- Everyone signed-in can READ the shared pool data.
do $$ begin
  create policy read_all_profiles      on profiles      for select using (true);
  create policy read_all_seasons       on seasons       for select using (true);
  create policy read_all_weeks         on weeks         for select using (true);
  create policy read_all_participants  on participants  for select using (true);
  create policy read_all_golfers       on golfers       for select using (true);
  create policy read_all_picks         on picks         for select using (true);
  create policy read_all_scores        on golfer_scores for select using (true);
  create policy read_all_weekly        on weekly_scores for select using (true);
  create policy read_all_standings     on standings     for select using (true);
  create policy read_all_announce      on announcements for select using (true);
exception when duplicate_object then null; end $$;

-- A participant may insert/delete ONLY their own picks (trigger enforces limits/lock).
do $$ begin
  create policy insert_own_picks on picks for insert
    with check (participant_id in (select id from participants where profile_id = auth.uid()));
  create policy delete_own_picks on picks for delete
    using (participant_id in (select id from participants where profile_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- Commissioners can do everything on management tables.
do $$ begin
  create policy commish_seasons      on seasons      for all using (is_commissioner()) with check (is_commissioner());
  create policy commish_weeks        on weeks        for all using (is_commissioner()) with check (is_commissioner());
  create policy commish_participants on participants for all using (is_commissioner()) with check (is_commissioner());
  create policy commish_picks        on picks        for all using (is_commissioner()) with check (is_commissioner());
  create policy commish_announce     on announcements for all using (is_commissioner()) with check (is_commissioner());
  create policy commish_audit        on audit_log    for all using (is_commissioner()) with check (is_commissioner());
exception when duplicate_object then null; end $$;

-- Everyone can read the audit log? No — commissioners only (covered above).

-- =====================================================================
-- REALTIME: broadcast changes so every browser stays in sync
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table standings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table golfer_scores;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table picks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table announcements;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- SEED: one active season + the three playoff weeks
-- =====================================================================
do $$
declare s_id uuid;
begin
  if not exists (select 1 from seasons where is_active) then
    insert into seasons (name) values ('FedEx Cup 2026') returning id into s_id;
    insert into weeks (season_id, week_number, name, picks_required, status) values
      (s_id, 1, 'FedEx St. Jude Championship', 5, 'upcoming'),
      (s_id, 2, 'BMW Championship',            4, 'upcoming'),
      (s_id, 3, 'TOUR Championship',           3, 'upcoming');
  end if;
end $$;
