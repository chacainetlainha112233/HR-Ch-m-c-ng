-- Run after owner-role.sql, employee-permissions.sql and owner-approvals.sql.
-- Adds manager administration, departments, shifts, leave and overtime workflows.
-- Run manager-role.sql first and wait for it to commit.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('own','admin','manager','employee'));

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists department_id uuid references public.departments(id) on delete set null;

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  work_date date not null,
  shift text not null check (shift in ('morning','evening')),
  start_time time not null,
  end_time time not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check(to_date >= from_date)
);

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  hours numeric(4,2) not null check(hours > 0 and hours <= 12),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_manager_or_admin()
returns boolean language sql security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('own','admin','manager')); $$;
create or replace function public.can_manage_employee(p_employee uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('own','admin'))
  or exists(select 1 from public.profiles manager join public.profiles employee on employee.department_id=manager.department_id where manager.id=auth.uid() and manager.is_active and manager.role='manager' and employee.id=p_employee and employee.role='employee');
$$;

create or replace function public.can_read_profile(p_profile uuid)
returns boolean language sql security definer set search_path = public
as $$ select p_profile=auth.uid() or public.is_admin() or exists(
  select 1 from public.profiles manager
  join public.profiles employee on employee.department_id=manager.department_id
  where manager.id=auth.uid() and manager.is_active and manager.role='manager'
    and employee.id=p_profile and employee.role='employee'
); $$;

drop policy if exists "Profile read scope" on public.profiles;
create policy "Profile read scope" on public.profiles as restrictive for select to authenticated using (public.can_read_profile(id));
-- A restrictive policy cannot grant access on its own. Both layers must allow it.
drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile" on public.profiles for select to authenticated
  using (public.can_read_profile(id));

drop policy if exists "Managers manage shifts" on public.shift_assignments;
drop policy if exists "Managers review leave" on public.leave_requests;
drop policy if exists "Managers review overtime" on public.overtime_requests;
alter table public.departments enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.leave_requests enable row level security;
alter table public.overtime_requests enable row level security;
drop policy if exists "Users read active departments" on public.departments;
create policy "Users read active departments" on public.departments for select to authenticated using (is_active or public.is_manager_or_admin());
drop policy if exists "Admin manage departments" on public.departments;
create policy "Admin manage departments" on public.departments for all to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin'))) with check (exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin')));
drop policy if exists "Users read assigned shifts" on public.shift_assignments;
create policy "Users read assigned shifts" on public.shift_assignments for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
drop policy if exists "Users read own requests" on public.leave_requests;
create policy "Users read own requests" on public.leave_requests for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
drop policy if exists "Employees create leave" on public.leave_requests;
create policy "Employees create leave" on public.leave_requests for insert to authenticated with check (employee_id=auth.uid());
drop policy if exists "Users read own overtime" on public.overtime_requests;
create policy "Users read own overtime" on public.overtime_requests for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
drop policy if exists "Employees create overtime" on public.overtime_requests;
create policy "Employees create overtime" on public.overtime_requests for insert to authenticated with check (employee_id=auth.uid());

-- Safe manager-facing profile update: managers can only modify employees in their department.
create or replace function public.manager_update_employee(p_id uuid, p_full_name text, p_department_id uuid, p_is_active boolean)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not public.can_manage_employee(p_id) then raise exception 'Không có quyền quản lý nhân viên này.' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where id=auth.uid() and role='manager' and department_id is distinct from p_department_id) then raise exception 'Manager chỉ quản lý department của mình.' using errcode='42501'; end if;
  update public.profiles set full_name=trim(p_full_name), department_id=p_department_id, is_active=p_is_active where id=p_id and role='employee' returning * into result;
  if result.id is null then raise exception 'Không tìm thấy nhân viên.'; end if;
  return result;
end; $$;
revoke all on function public.manager_update_employee(uuid,text,uuid,boolean) from public;
grant execute on function public.manager_update_employee(uuid,text,uuid,boolean) to authenticated;

-- Admin-only role assignment; managers can never promote accounts.
create or replace function public.admin_set_user_role(p_id uuid, p_role text)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin') and is_active) then raise exception 'Chỉ admin được phân quyền.' using errcode='42501'; end if;
  if p_role not in ('admin','manager','employee') then raise exception 'Vai trò không hợp lệ.' using errcode='42501'; end if;
  update public.profiles set role=p_role::public.user_role where id=p_id and role<>'own' returning * into result;
  return result;
end; $$;
revoke all on function public.admin_set_user_role(uuid,text) from public;
grant execute on function public.admin_set_user_role(uuid,text) to authenticated;

create or replace function public.admin_update_user_access(p_id uuid, p_role text, p_is_active boolean, p_department_id uuid)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin') and is_active) then raise exception 'Chỉ admin được phân quyền.' using errcode='42501'; end if;
  if p_role not in ('admin','manager','employee') or (p_id=auth.uid() and p_role<>'admin') then raise exception 'Không thể thay đổi role own hoặc tự hạ quyền admin.' using errcode='42501'; end if;
  update public.profiles set role=p_role::public.user_role, is_active=p_is_active, department_id=p_department_id where id=p_id and role<>'own' returning * into result;
  if result.id is null then raise exception 'Không tìm thấy tài khoản.'; end if;
  return result;
end; $$;
revoke all on function public.admin_update_user_access(uuid,text,boolean,uuid) from public;
grant execute on function public.admin_update_user_access(uuid,text,boolean,uuid) to authenticated;

create or replace function public.manager_save_shift(p_employee uuid, p_work_date date, p_shift text, p_note text default null)
returns public.shift_assignments language plpgsql security definer set search_path = public
as $$ declare result public.shift_assignments; dept uuid;
begin
  if p_shift not in ('morning','evening') or not public.can_manage_employee(p_employee) then raise exception 'Không có quyền xếp ca này.' using errcode='42501'; end if;
  select department_id into dept from public.profiles where id=p_employee and role='employee' and is_active;
  if dept is null then raise exception 'Nhân viên không hợp lệ.'; end if;
  insert into public.shift_assignments(employee_id,department_id,work_date,shift,start_time,end_time,note,created_by)
  values(p_employee,dept,p_work_date,p_shift,case when p_shift='morning' then '08:00'::time else '17:00'::time end,case when p_shift='morning' then '17:00'::time else '02:00'::time end,trim(p_note),auth.uid())
  on conflict(employee_id,work_date) do update set department_id=excluded.department_id,shift=excluded.shift,start_time=excluded.start_time,end_time=excluded.end_time,note=excluded.note,created_by=excluded.created_by
  returning * into result;
  return result;
end; $$;
revoke all on function public.manager_save_shift(uuid,date,text,text) from public;
grant execute on function public.manager_save_shift(uuid,date,text,text) to authenticated;

create or replace function public.manager_review_request(p_kind text, p_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public
as $$ declare employee_id uuid;
begin
  if p_status not in ('approved','rejected') or p_kind not in ('leave','overtime') then raise exception 'Yêu cầu không hợp lệ.'; end if;
  if p_kind='leave' then select l.employee_id into employee_id from public.leave_requests l where l.id=p_id; else select o.employee_id into employee_id from public.overtime_requests o where o.id=p_id; end if;
  if employee_id is null or not public.can_manage_employee(employee_id) then raise exception 'Không có quyền duyệt yêu cầu này.' using errcode='42501'; end if;
  if p_kind='leave' then update public.leave_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id; else update public.overtime_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id; end if;
  return true;
end; $$;
revoke all on function public.manager_review_request(text,uuid,text) from public;
grant execute on function public.manager_review_request(text,uuid,text) to authenticated;
