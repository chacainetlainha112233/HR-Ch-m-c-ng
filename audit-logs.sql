-- Run after the base schema and owner-role migrations.
create type public.audit_event as enum ('login', 'logout', 'password_change');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event public.audit_event not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index audit_logs_user_id_idx on public.audit_logs (user_id);
alter table public.audit_logs enable row level security;

create policy "Admins read audit logs" on public.audit_logs
  for select to authenticated using (public.is_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

drop function if exists public.log_auth_event(public.audit_event, jsonb);
create or replace function public.log_auth_event(p_event public.audit_event, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập.' using errcode = '42501'; end if;
  insert into public.audit_logs (user_id, event, metadata)
  values (auth.uid(), p_event, coalesce(p_metadata, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.log_auth_event(public.audit_event, jsonb) from public;
grant execute on function public.log_auth_event(public.audit_event, jsonb) to authenticated;

-- The password Edge Function uses service_role and writes the event directly.
revoke insert, update, delete on public.audit_logs from service_role;
grant insert on public.audit_logs to service_role;
