-- Run after supabase-schema.sql. Keeps Whitelist IP policies intact. Safe to rerun.
begin;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)), 'employee');
  return new;
end;
$$;

-- Restrictive guards apply even if another permissive policy is added later.
drop policy if exists "Attendance employee scope" on public.attendance;
create policy "Attendance employee scope" on public.attendance
  as restrictive for all to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());
drop policy if exists "Only admins delete attendance" on public.attendance;
create policy "Only admins delete attendance" on public.attendance
  as restrictive for delete to authenticated using (public.is_admin());
drop policy if exists "Profile read scope" on public.profiles;
create policy "Profile read scope" on public.profiles
  as restrictive for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "Only admins insert profiles" on public.profiles;
create policy "Only admins insert profiles" on public.profiles
  as restrictive for insert to authenticated with check (public.is_admin());
drop policy if exists "Only admins update profiles" on public.profiles;
create policy "Only admins update profiles" on public.profiles
  as restrictive for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Only admins delete profiles" on public.profiles;
create policy "Only admins delete profiles" on public.profiles
  as restrictive for delete to authenticated using (public.is_admin());

-- Employees can start a shift once, then end it once. Time comes from the server.
create or replace function public.guard_employee_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.employee_id is distinct from auth.uid() or new.check_out is not null or new.note is not null then
      raise exception 'Bạn chỉ được bắt đầu ca của chính mình.' using errcode = '42501';
    end if;
    new.work_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
    new.check_in := now();
    new.created_at := now();
  else
    if old.employee_id is distinct from auth.uid()
      or old.check_in is null or old.check_out is not null or new.check_out is null
      or new.id is distinct from old.id
      or new.employee_id is distinct from old.employee_id
      or new.work_date is distinct from old.work_date
      or new.check_in is distinct from old.check_in
      or new.created_at is distinct from old.created_at
      or new.note is distinct from old.note then
      raise exception 'Bạn chỉ được kết thúc ca đang mở của chính mình; không được sửa lịch sử.' using errcode = '42501';
    end if;
    new.check_out := now();
  end if;
  return new;
end;
$$;
drop trigger if exists guard_employee_attendance on public.attendance;
create trigger guard_employee_attendance before insert or update on public.attendance
  for each row execute function public.guard_employee_attendance();
commit;
