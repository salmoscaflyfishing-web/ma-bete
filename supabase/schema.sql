-- =====================================================================
--  Registre du Troupeau — schéma Supabase
--  À coller en entier dans Supabase : SQL Editor → New query → Run.
--  Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

-- Une exploitation (élevage) partagée entre plusieurs comptes
create table if not exists public.farms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Qui a accès à quelle exploitation, avec quel rôle
create table if not exists public.farm_members (
  farm_id     uuid not null references public.farms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  email       text,
  created_at  timestamptz not null default now(),
  primary key (farm_id, user_id)
);
create index if not exists farm_members_user_idx on public.farm_members (user_id);

-- Invitations envoyées par le propriétaire (acceptées automatiquement à la connexion de l'invité)
create table if not exists public.farm_invitations (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms (id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role        text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  invited_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (farm_id, email)
);
create index if not exists farm_invitations_email_idx on public.farm_invitations (email);

-- Table unique des données du registre : animaux, évènements, finances, stock de boucles.
-- Suppression logique (deleted = true) pour que les autres appareils l'apprennent aussi.
create table if not exists public.records (
  farm_id     uuid not null references public.farms (id) on delete cascade,
  collection  text not null check (collection in ('animaux', 'evenements', 'finances', 'boucles')),
  id          text not null check (length(id) between 1 and 100),
  data        jsonb not null default '{}'::jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  primary key (farm_id, collection, id)
);
create index if not exists records_farm_updated_idx on public.records (farm_id, updated_at);

-- Mise à jour d'une base créée avec une version précédente : autorise la collection « boucles »
alter table public.records drop constraint if exists records_collection_check;
alter table public.records add constraint records_collection_check
  check (collection in ('animaux', 'evenements', 'finances', 'boucles'));

-- ---------- Fonctions utilitaires --------------------------------------

-- Rôle de l'utilisateur connecté dans une exploitation (null s'il n'en est pas membre)
create or replace function public.farm_role(p_farm uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.farm_members where farm_id = p_farm and user_id = auth.uid()
$$;

-- E-mail de l'utilisateur connecté (en minuscules)
create or replace function public.current_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

-- Date de mise à jour fixée par le serveur (et non par l'horloge du téléphone)
create or replace function public.records_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- ---------- Fonctions appelées par l'application -----------------------

-- Créer une exploitation : l'utilisateur en devient propriétaire
create or replace function public.create_farm(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into public.farms (name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  insert into public.farm_members (farm_id, user_id, role, email) values (v_id, auth.uid(), 'owner', public.current_email());
  return v_id;
end $$;

-- Exploitations accessibles par l'utilisateur connecté
create or replace function public.my_farms()
returns table (farm_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, m.role
  from public.farm_members m join public.farms f on f.id = m.farm_id
  where m.user_id = auth.uid()
  order by f.name
$$;

-- Accepter les invitations adressées à l'e-mail (confirmé) de l'utilisateur connecté
create or replace function public.accept_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare v_email text; v_n integer := 0; r record;
begin
  select lower(email) into v_email from auth.users
   where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for r in select * from public.farm_invitations where email = v_email loop
    insert into public.farm_members (farm_id, user_id, role, email)
      values (r.farm_id, auth.uid(), r.role, v_email)
      on conflict (farm_id, user_id) do nothing;
    delete from public.farm_invitations where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Changer le rôle d'un membre (propriétaire uniquement ; il doit toujours rester un propriétaire)
create or replace function public.set_member_role(p_farm uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.farm_role(p_farm) is distinct from 'owner' then raise exception 'Réservé au propriétaire'; end if;
  if p_role not in ('owner', 'editor', 'viewer') then raise exception 'Rôle inconnu'; end if;
  update public.farm_members set role = p_role where farm_id = p_farm and user_id = p_user;
  if not exists (select 1 from public.farm_members where farm_id = p_farm and role = 'owner') then
    raise exception 'L''exploitation doit garder au moins un propriétaire';
  end if;
end $$;

-- Retirer un membre (propriétaire), ou quitter soi-même l'exploitation
create or replace function public.remove_member(p_farm uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.farm_role(p_farm) is distinct from 'owner' and p_user is distinct from auth.uid() then
    raise exception 'Réservé au propriétaire';
  end if;
  delete from public.farm_members where farm_id = p_farm and user_id = p_user;
  if not exists (select 1 from public.farm_members where farm_id = p_farm and role = 'owner') then
    raise exception 'L''exploitation doit garder au moins un propriétaire';
  end if;
end $$;

-- ---------- Sécurité : Row Level Security ------------------------------

alter table public.farms            enable row level security;
alter table public.farm_members     enable row level security;
alter table public.farm_invitations enable row level security;
alter table public.records          enable row level security;

drop policy if exists farms_select on public.farms;
create policy farms_select on public.farms for select to authenticated
  using (public.farm_role(id) is not null);
drop policy if exists farms_update on public.farms;
create policy farms_update on public.farms for update to authenticated
  using (public.farm_role(id) = 'owner') with check (public.farm_role(id) = 'owner');
drop policy if exists farms_delete on public.farms;
create policy farms_delete on public.farms for delete to authenticated
  using (public.farm_role(id) = 'owner');

drop policy if exists members_select on public.farm_members;
create policy members_select on public.farm_members for select to authenticated
  using (public.farm_role(farm_id) is not null);

drop policy if exists invitations_select on public.farm_invitations;
create policy invitations_select on public.farm_invitations for select to authenticated
  using (public.farm_role(farm_id) = 'owner' or email = public.current_email());
drop policy if exists invitations_insert on public.farm_invitations;
create policy invitations_insert on public.farm_invitations for insert to authenticated
  with check (public.farm_role(farm_id) = 'owner');
drop policy if exists invitations_update on public.farm_invitations;
create policy invitations_update on public.farm_invitations for update to authenticated
  using (public.farm_role(farm_id) = 'owner') with check (public.farm_role(farm_id) = 'owner');
drop policy if exists invitations_delete on public.farm_invitations;
create policy invitations_delete on public.farm_invitations for delete to authenticated
  using (public.farm_role(farm_id) = 'owner');

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (public.farm_role(farm_id) is not null);
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.farm_role(farm_id) in ('owner', 'editor'));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.farm_role(farm_id) in ('owner', 'editor'))
  with check (public.farm_role(farm_id) in ('owner', 'editor'));
-- Pas de suppression définitive depuis l'application (suppression logique uniquement).

-- ---------- Droits d'accès ---------------------------------------------

revoke all on public.farms, public.farm_members, public.farm_invitations, public.records from anon;
grant select, update, delete on public.farms to authenticated;
grant select on public.farm_members to authenticated;
grant select, insert, update, delete on public.farm_invitations to authenticated;
grant select, insert, update on public.records to authenticated;

revoke execute on function public.farm_role(uuid), public.current_email(), public.create_farm(text), public.my_farms(),
  public.accept_invitations(), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.farm_role(uuid), public.current_email(), public.create_farm(text), public.my_farms(),
  public.accept_invitations(), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid) to authenticated;

-- ---------- Temps réel (mise à jour instantanée entre appareils) -------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
