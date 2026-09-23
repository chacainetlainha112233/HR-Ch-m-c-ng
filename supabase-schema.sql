-- Run this once in Supabase SQL Editor.
create type public.user_role as enum ('own', 'admin', 'employee');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'employee',
  department text,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.attendance enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('own', 'admin')); $$;

create policy "Users can read their profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "Admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "Users read own attendance" on public.attendance for select using (employee_id = auth.uid() or public.is_admin());
create policy "Users create own attendance" on public.attendance for insert with check (employee_id = auth.uid());
create policy "Users update own attendance" on public.attendance for update using (employee_id = auth.uid() or public.is_admin()) with check (employee_id = auth.uid() or public.is_admin());

-- After creating the first user in Authentication > Users, promote them:
-- update public.profiles set role = 'admin' where id = 'USER_UUID';
