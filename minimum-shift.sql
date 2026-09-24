-- Run after employee-permissions.sql and owner-approvals.sql.
-- Enforces the rule at database level for direct API calls as well.
create or replace function public.guard_employee_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_owner() and current_user <> 'authenticated' then return new; end if;
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
    if now() < old.check_in + interval '8 hours' then
      raise exception 'Chưa đủ 8 giờ kể từ khi vào ca.' using errcode = '42501';
    end if;
    new.check_out := now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_employee_attendance on public.attendance;
create trigger guard_employee_attendance before insert or update on public.attendance
  for each row execute function public.guard_employee_attendance();