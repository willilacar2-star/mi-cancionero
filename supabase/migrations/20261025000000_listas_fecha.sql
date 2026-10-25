-- Agenda: cada lista puede tener la fecha del evento (opcional).
-- La app filtra las listas por rango de fechas y las ordena por fecha.
alter table public.listas add column if not exists fecha date;
create index if not exists listas_fecha_idx on public.listas (fecha);
