-- Run after owner-role.sql, employee-permissions.sql and owner-approvals.sql.
-- Adds manager administration, departments, shifts, leave and overtime workflows.
alter type public.user_role add value if not exists 'manager';

do $$ begin
  if not exists (select 1 from pg_type where typname = 'shift_type') then
    create type public.shift_type as enum ('morning','evening');
  end if;
end $$;

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
  shift public.shift_type not null,
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

drop policy if exists "Profile read scope" on public.profiles;
create policy "Profile read scope" on public.profiles
  as restrictive for select to authenticated using (
    id=auth.uid() or public.is_admin() or exists(
      select 1 from public.profiles manager
      where manager.id=auth.uid() and manager.role='manager' and manager.is_active
        and manager.department_id=public.profiles.department_id
    )
  );

alter table public.departments enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.leave_requests enable row level security;
alter table public.overtime_requests enable row level security;
create policy "Users read active departments" on public.departments for select to authenticated using (is_active or public.is_manager_or_admin());
create policy "Admin manage departments" on public.departments for all to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin'))) with check (exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin')));
create policy "Users read assigned shifts" on public.shift_assignments for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
create policy "Managers manage shifts" on public.shift_assignments for all to authenticated using (public.can_manage_employee(employee_id)) with check (public.can_manage_employee(employee_id));
create policy "Users read own requests" on public.leave_requests for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
create policy "Employees create leave" on public.leave_requests for insert to authenticated with check (employee_id=auth.uid());
create policy "Managers review leave" on public.leave_requests for update to authenticated using (public.can_manage_employee(employee_id)) with check (public.can_manage_employee(employee_id));
create policy "Users read own overtime" on public.overtime_requests for select to authenticated using (employee_id=auth.uid() or public.can_manage_employee(employee_id));
create policy "Employees create overtime" on public.overtime_requests for insert to authenticated with check (employee_id=auth.uid());
create policy "Managers review overtime" on public.overtime_requests for update to authenticated using (public.can_manage_employee(employee_id)) with check (public.can_manage_employee(employee_id));

-- Safe manager-facing profile update: managers can only modify employees in their department.
create or replace function public.manager_update_employee(p_id uuid, p_full_name text, p_department_id uuid, p_is_active boolean)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not public.can_manage_employee(p_id) then raise exception 'Không có quyền quản lý nhân viên này.' using errcode='42501'; end if;
  update public.profiles set full_name=trim(p_full_name), department_id=p_department_id, is_active=p_is_active where id=p_id and role='employee' returning * into result;
  if result.id is null then raise exception 'Không tìm thấy nhân viên.'; end if;
  return result;
end; $$;
revoke all on function public.manager_update_employee(uuid,text,uuid,boolean) from public;
grant execute on function public.manager_update_employee(uuid,text,uuid,boolean) to authenticated;

-- Admin-only role assignment; managers can never promote accounts.
create or replace function public.admin_set_user_role(p_id uuid, p_role public.user_role)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin') and is_active) then raise exception 'Chỉ admin được phân quyền.' using errcode='42501'; end if;
  if p_role='own' then raise exception 'Không thể cấp role own từ giao diện.' using errcode='42501'; end if;
  update public.profiles set role=p_role where id=p_id and role<>'own' returning * into result;
  return result;
end; $$;
revoke all on function public.admin_set_user_role(uuid,public.user_role) from public;
grant execute on function public.admin_set_user_role(uuid,public.user_role) to authenticated;

create or replace function public.admin_update_user_access(p_id uuid, p_role public.user_role, p_is_active boolean, p_department_id uuid)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('own','admin') and is_active) then raise exception 'Chỉ admin được phân quyền.' using errcode='42501'; end if;
  if p_role='own' or p_id=auth.uid() and p_role<>'admin' then raise exception 'Không thể thay đổi role own hoặc tự hạ quyền admin.' using errcode='42501'; end if;
  update public.profiles set role=p_role, is_active=p_is_active, department_id=p_department_id where id=p_id and role<>'own' returning * into result;
  if result.id is null then raise exception 'Không tìm thấy tài khoản.'; end if;
  return result;
end; $$;
revoke all on function public.admin_update_user_access(uuid,public.user_role,boolean,uuid) from public;
grant execute on function public.admin_update_user_access(uuid,public.user_role,boolean,uuid) to authenticated;
