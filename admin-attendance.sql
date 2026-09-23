-- Run after schema, whitelist-ip.sql and employee-permissions.sql. Safe to rerun.
begin;
create table if not exists public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id),
  admin_id uuid not null references public.profiles(id),
  reason text not null,
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.attendance_adjustments enable row level security;
revoke all on public.attendance_adjustments from anon, authenticated;
grant select on public.attendance_adjustments to authenticated;
drop policy if exists "Admins read adjustments" on public.attendance_adjustments;
create policy "Admins read adjustments" on public.attendance_adjustments
  for select to authenticated using (public.is_admin());

create or replace function public.admin_save_attendance(
  p_employee_id uuid, p_work_date date, p_check_in timestamptz,
  p_check_out timestamptz, p_reason text, p_expected jsonb default null
) returns public.attendance
language plpgsql security definer set search_path = '' as $$
declare previous public.attendance; saved public.attendance;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Chỉ quản trị viên được bổ sung công.' using errcode = '42501';
  end if;
  -- Keep the existing whitelist rule, including administrator writes.
  if not public.attendance_ip_allowed() then
    raise exception 'IP hiện tại không được phép bổ sung công.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee_id and role = 'employee') then
    raise exception 'Không tìm thấy nhân viên.';
  end if;
  if p_work_date is null or p_check_in is null or not isfinite(p_check_in)
    or (p_check_in at time zone 'Asia/Ho_Chi_Minh')::date <> p_work_date
    or p_check_in > now()
    or (p_check_out is not null and (not isfinite(p_check_out) or p_check_out < p_check_in or p_check_out > now())) then
    raise exception 'Ngày công/giờ vào/giờ ra không hợp lệ hoặc nằm trong tương lai.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 1000 then
    raise exception 'Nhập lý do bổ sung công (tối đa 1000 ký tự).';
  end if;
  select * into previous from public.attendance
    where employee_id = p_employee_id and work_date = p_work_date for update;
  if found then
    if p_expected is null or
      (to_jsonb(previous) - 'created_at') is distinct from (p_expected - 'created_at') then
      raise exception 'Bản ghi đã thay đổi. Hãy tải lại công trước khi lưu.';
    end if;
    update public.attendance set check_in = p_check_in, check_out = p_check_out, note = trim(p_reason)
      where id = previous.id returning * into saved;
  else
    if p_expected is not null then raise exception 'Bản ghi đã thay đổi. Hãy tải lại công.'; end if;
    insert into public.attendance (employee_id, work_date, check_in, check_out, note)
      values (p_employee_id, p_work_date, p_check_in, p_check_out, trim(p_reason)) returning * into saved;
  end if;
  insert into public.attendance_adjustments (attendance_id, admin_id, reason, before_value, after_value)
    values (saved.id, auth.uid(), trim(p_reason), case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.admin_save_attendance(uuid,date,timestamptz,timestamptz,text,jsonb) from public;
grant execute on function public.admin_save_attendance(uuid,date,timestamptz,timestamptz,text,jsonb) to authenticated;
commit;
