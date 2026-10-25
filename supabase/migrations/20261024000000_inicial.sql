-- Mi Cancionero: tablas, seguridad (RLS) y funciones de orden.
-- Lectura pública. Escritura solo para los correos que estén en la tabla editores.

/* ---------- Editores: correos que pueden escribir ---------- */
create table if not exists public.editores (
  email  text primary key check (email = lower(email)),
  creado timestamptz not null default now()
);
-- Sin políticas: nadie la lee ni la cambia desde la app. Se administra desde el SQL Editor.
alter table public.editores enable row level security;

-- true si el usuario con sesión iniciada está en editores.
-- security definer para poder leer editores aunque la tabla no tenga políticas.
create or replace function public.es_editor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editores e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.es_editor() from public;
grant execute on function public.es_editor() to anon, authenticated;

/* ---------- updated_at automático ---------- */
create or replace function public.poner_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/* ---------- Canciones ---------- */
-- El orden de la tabla (columna orden) es el orden de las canciones dentro de cada medley.
create table if not exists public.canciones (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null check (btrim(titulo) <> ''),
  artista    text not null default '',
  tono       text not null default '',
  categoria  text not null default 'Alabanza',
  seccion    text not null default 'General',
  orden      int  not null default 0,
  estructura jsonb,
  contenido  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists canciones_orden_idx on public.canciones (orden);

create trigger canciones_updated_at
  before update on public.canciones
  for each row execute function public.poner_updated_at();

/* ---------- Listas ---------- */
create table if not exists public.listas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  orden      int  not null default 0,
  updated_at timestamptz not null default now()
);

create trigger listas_updated_at
  before update on public.listas
  for each row execute function public.poner_updated_at();

-- Una canción puede estar dos veces en la misma lista, por eso la clave es (lista_id, posicion).
create table if not exists public.lista_canciones (
  lista_id   uuid not null references public.listas (id) on delete cascade,
  cancion_id uuid not null references public.canciones (id) on delete cascade,
  posicion   int  not null,
  primary key (lista_id, posicion)
);
create index if not exists lista_canciones_cancion_idx on public.lista_canciones (cancion_id);

/* ---------- Permisos de la API (las políticas RLS de abajo deciden qué filas) ---------- */
revoke all on public.editores from anon, authenticated;
grant select on public.canciones, public.listas, public.lista_canciones to anon, authenticated;
grant insert, update, delete on public.canciones, public.listas, public.lista_canciones to authenticated;

/* ---------- RLS ---------- */
alter table public.canciones       enable row level security;
alter table public.listas          enable row level security;
alter table public.lista_canciones enable row level security;

create policy "Lectura pública" on public.canciones
  for select to anon, authenticated using (true);
create policy "Editores insertan" on public.canciones
  for insert to authenticated with check (public.es_editor());
create policy "Editores cambian" on public.canciones
  for update to authenticated using (public.es_editor()) with check (public.es_editor());
create policy "Editores borran" on public.canciones
  for delete to authenticated using (public.es_editor());

create policy "Lectura pública" on public.listas
  for select to anon, authenticated using (true);
create policy "Editores insertan" on public.listas
  for insert to authenticated with check (public.es_editor());
create policy "Editores cambian" on public.listas
  for update to authenticated using (public.es_editor()) with check (public.es_editor());
create policy "Editores borran" on public.listas
  for delete to authenticated using (public.es_editor());

create policy "Lectura pública" on public.lista_canciones
  for select to anon, authenticated using (true);
create policy "Editores insertan" on public.lista_canciones
  for insert to authenticated with check (public.es_editor());
create policy "Editores cambian" on public.lista_canciones
  for update to authenticated using (public.es_editor()) with check (public.es_editor());
create policy "Editores borran" on public.lista_canciones
  for delete to authenticated using (public.es_editor());

/* ---------- Funciones de orden (todo o nada, en una sola llamada) ---------- */
-- security invoker: las políticas RLS de arriba se siguen aplicando.

-- Pone orden = 1, 2, 3… a las canciones en el orden del arreglo.
create or replace function public.reordenar_canciones(ids uuid[])
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if not public.es_editor() then raise exception 'Solo editores' using errcode = '42501'; end if;
  update public.canciones c set orden = t.n::int
  from unnest(ids) with ordinality as t(id, n)
  where c.id = t.id and c.orden is distinct from t.n::int;
end;
$$;

-- Pone orden = 1, 2, 3… a las listas en el orden del arreglo.
create or replace function public.reordenar_listas(ids uuid[])
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if not public.es_editor() then raise exception 'Solo editores' using errcode = '42501'; end if;
  update public.listas l set orden = t.n::int
  from unnest(ids) with ordinality as t(id, n)
  where l.id = t.id and l.orden is distinct from t.n::int;
end;
$$;

-- Reemplaza las canciones de una lista por las del arreglo, en ese orden.
create or replace function public.guardar_lista(p_lista uuid, p_canciones uuid[])
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if not public.es_editor() then raise exception 'Solo editores' using errcode = '42501'; end if;
  delete from public.lista_canciones where lista_id = p_lista;
  insert into public.lista_canciones (lista_id, cancion_id, posicion)
  select p_lista, t.id, t.n::int
  from unnest(p_canciones) with ordinality as t(id, n);
  update public.listas set updated_at = now() where id = p_lista;
end;
$$;

revoke all on function public.reordenar_canciones(uuid[]) from public, anon;
revoke all on function public.reordenar_listas(uuid[]) from public, anon;
revoke all on function public.guardar_lista(uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_canciones(uuid[]) to authenticated;
grant execute on function public.reordenar_listas(uuid[]) to authenticated;
grant execute on function public.guardar_lista(uuid, uuid[]) to authenticated;
