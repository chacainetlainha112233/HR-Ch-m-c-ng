-- Run after supabase-schema.sql (also safe to rerun).
begin;
create table if not exists public.ip_whitelist (
  id uuid primary key default gen_random_uuid(),
  network cidr not null unique,
  label text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ip_whitelist enable row level security;
grant select, insert, delete on public.ip_whitelist to authenticated;
drop policy if exists "Admins manage IP whitelist" on public.ip_whitelist;
create policy "Admins manage IP whitelist" on public.ip_whitelist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Hosted Supabase behind Cloudflare only. No fallback to client-supplied XFF.
create or replace function public.attendance_client_ip()
returns inet language plpgsql stable set search_path = '' as $$
declare value text;
begin
  value := current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip';
  if value is null or value = '' or position('/' in value) > 0 then return null; end if;
  return value::inet;
exception when invalid_text_representation then return null;
end;
$$;
create or replace function public.attendance_ip_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.ip_whitelist where public.attendance_client_ip() <<= network
  );
$$;
revoke all on function public.attendance_client_ip() from public;
revoke all on function public.attendance_ip_allowed() from public;
grant execute on function public.attendance_client_ip() to authenticated;
grant execute on function public.attendance_ip_allowed() to authenticated;

-- Restrictive policies also constrain existing/future permissive write policies.
drop policy if exists "Attendance insert requires allowed IP" on public.attendance;
create policy "Attendance insert requires allowed IP" on public.attendance
  as restrictive for insert to authenticated with check (public.attendance_ip_allowed());
drop policy if exists "Attendance update requires allowed IP" on public.attendance;
create policy "Attendance update requires allowed IP" on public.attendance
  as restrictive for update to authenticated
  using (public.attendance_ip_allowed()) with check (public.attendance_ip_allowed());
commit;
