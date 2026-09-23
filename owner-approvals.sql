-- Run LAST, after owner-role.sql has committed and all earlier migrations.
begin;
alter table public.profiles add column if not exists is_active boolean not null default true;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='own' and is_active);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','own') and is_active);
$$;
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active);
$$;
create table if not exists public.admin_permissions (
 user_id uuid primary key references public.profiles(id),
 can_create_employees boolean not null default false
);
alter table public.admin_permissions enable row level security;
revoke all on public.admin_permissions from anon, authenticated;
grant select on public.admin_permissions to authenticated;
drop policy if exists "Read admin permissions" on public.admin_permissions;
create policy "Read admin permissions" on public.admin_permissions for select to authenticated
 using (public.is_active_user() and (user_id=auth.uid() or public.is_owner()));

create table if not exists public.approval_requests (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references public.profiles(id),
 action text not null check (action in ('attendance_save','attendance_delete','ip_add','ip_delete','profile_update','permission_change')),
 target_id uuid,
 payload jsonb not null,
 before_value jsonb,
 reason text not null,
 status text not null default 'pending' check (status in ('pending','applied','rejected','failed')),
 reviewer_id uuid references public.profiles(id),
 review_note text,
 error_message text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
alter table public.approval_requests enable row level security;
revoke all on public.approval_requests from anon, authenticated;
grant select on public.approval_requests to authenticated;
drop policy if exists "Read own requests or owner inbox" on public.approval_requests;
create policy "Read own requests or owner inbox" on public.approval_requests for select to authenticated
 using (public.is_admin() and (requester_id=auth.uid() or public.is_owner()));
create index if not exists approval_requests_pending on public.approval_requests(status,created_at);

-- No direct management writes, even when a previous permissive policy allows them.
drop policy if exists "Active attendance access" on public.attendance;
create policy "Active attendance access" on public.attendance as restrictive for all to authenticated
 using(public.is_active_user()) with check(public.is_active_user());
drop policy if exists "Direct attendance insert is self only" on public.attendance;
create policy "Direct attendance insert is self only" on public.attendance as restrictive for insert to authenticated
 with check(employee_id=auth.uid());
drop policy if exists "Direct attendance update is self only" on public.attendance;
create policy "Direct attendance update is self only" on public.attendance as restrictive for update to authenticated
 using(employee_id=auth.uid()) with check(employee_id=auth.uid());
drop policy if exists "No direct attendance delete" on public.attendance;
create policy "No direct attendance delete" on public.attendance as restrictive for delete to authenticated using(false);
drop policy if exists "Active profile access" on public.profiles;
create policy "Active profile access" on public.profiles as restrictive for all to authenticated
 using(public.is_active_user()) with check(public.is_active_user());
drop policy if exists "No direct profile insert" on public.profiles;
create policy "No direct profile insert" on public.profiles as restrictive for insert to authenticated with check(false);
drop policy if exists "No direct profile update" on public.profiles;
create policy "No direct profile update" on public.profiles as restrictive for update to authenticated using(false) with check(false);
drop policy if exists "No direct profile delete" on public.profiles;
create policy "No direct profile delete" on public.profiles as restrictive for delete to authenticated using(false);
drop policy if exists "No direct IP insert" on public.ip_whitelist;
create policy "No direct IP insert" on public.ip_whitelist as restrictive for insert to authenticated with check(false);
drop policy if exists "No direct IP update" on public.ip_whitelist;
create policy "No direct IP update" on public.ip_whitelist as restrictive for update to authenticated using(false) with check(false);
drop policy if exists "No direct IP delete" on public.ip_whitelist;
create policy "No direct IP delete" on public.ip_whitelist as restrictive for delete to authenticated using(false);

-- Preserve the audit when an owner approves deletion of attendance.
alter table public.attendance_adjustments alter column attendance_id drop not null;
alter table public.attendance_adjustments drop constraint if exists attendance_adjustments_attendance_id_fkey;
alter table public.attendance_adjustments add constraint attendance_adjustments_attendance_id_fkey
 foreign key(attendance_id) references public.attendance(id) on delete set null;

create or replace function public.guard_employee_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  -- Only the owner approval SECURITY DEFINER call may bypass self check-in rules.
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
    new.check_out := now();
  end if;
  return new;
end;
$$;

-- Disable the old administrative write API. Only the approval function calls it.
revoke all on function public.admin_save_attendance(uuid,date,timestamptz,timestamptz,text,jsonb) from public, anon, authenticated;

create or replace function public.submit_approval(p_action text, p_target uuid, p_payload jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; request_id uuid; target_role public.user_role;
begin
 if not public.is_admin() then raise exception 'Chỉ admin/own được gửi yêu cầu.' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason))=0 or length(p_reason)>1000 then raise exception 'Nhập lý do (tối đa 1000 ký tự).'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>20000 then raise exception 'Nội dung không hợp lệ.'; end if;
 case p_action
 when 'attendance_save' then
   if not public.attendance_ip_allowed() then raise exception 'IP không được phép gửi bổ sung công.'; end if;
   if not exists(select 1 from public.profiles where id=(p_payload->>'p_employee_id')::uuid and role='employee' and is_active) then raise exception 'Nhân viên không hợp lệ.'; end if;
   select to_jsonb(a) into snapshot from public.attendance a where employee_id=(p_payload->>'p_employee_id')::uuid and work_date=(p_payload->>'p_work_date')::date;
   if (snapshot-'created_at') is distinct from (nullif(p_payload->'p_expected','null'::jsonb)-'created_at') then raise exception 'Công đã thay đổi. Hãy tải lại.'; end if;
   p_target := (snapshot->>'id')::uuid;
 when 'attendance_delete' then
   if not public.attendance_ip_allowed() then raise exception 'IP không được phép gửi xóa công.'; end if;
   select to_jsonb(a) into snapshot from public.attendance a where id=p_target;
   if snapshot is null then raise exception 'Không tìm thấy bản ghi công.'; end if;
 when 'ip_add' then
   perform (p_payload->>'network')::cidr;
   if nullif(p_payload->>'network','') is null then raise exception 'Nhập IP hoặc CIDR.'; end if;
   p_payload := jsonb_build_object('network',(p_payload->>'network')::cidr,'label',coalesce(p_payload->>'label',''));
 when 'ip_delete' then
   select to_jsonb(i) into snapshot from public.ip_whitelist i where id=p_target;
   if snapshot is null then raise exception 'Không tìm thấy IP.'; end if;
 when 'profile_update' then
   select to_jsonb(p),role into snapshot,target_role from public.profiles p where id=p_target;
   if snapshot is null or target_role='own' then raise exception 'Không thể thay đổi tài khoản own bằng yêu cầu này.'; end if;
   if p_payload->>'role' not in ('employee','admin') or p_payload->>'role' is null
     or nullif(trim(p_payload->>'full_name'),'') is null or length(p_payload->>'full_name')>120
     or jsonb_typeof(p_payload->'is_active') is distinct from 'boolean' then raise exception 'Thông tin/quyền không hợp lệ.'; end if;
   p_payload := jsonb_build_object('full_name',trim(p_payload->>'full_name'),'department',p_payload->>'department','role',p_payload->>'role','is_active',p_payload->'is_active');
 when 'permission_change' then
   if not exists(select 1 from public.profiles where id=p_target and role='admin' and is_active) then raise exception 'Chọn tài khoản admin đang hoạt động.'; end if;
   if jsonb_typeof(p_payload->'can_create_employees') is distinct from 'boolean' then raise exception 'Quyền không hợp lệ.'; end if;
   select to_jsonb(p) into snapshot from public.admin_permissions p where user_id=p_target;
   p_payload := jsonb_build_object('can_create_employees',p_payload->'can_create_employees');
 else raise exception 'Loại yêu cầu không được hỗ trợ.';
 end case;
 insert into public.approval_requests(requester_id,action,target_id,payload,before_value,reason)
 values(auth.uid(),p_action,p_target,p_payload,snapshot,trim(p_reason)) returning id into request_id;
 return request_id;
end;
$$;

create or replace function public.review_approval(p_id uuid, p_approve boolean, p_note text default '')
returns public.approval_requests language plpgsql security definer set search_path = '' as $$
declare req public.approval_requests; latest jsonb; saved public.attendance; failure text;
begin
 if not public.is_owner() then raise exception 'Chỉ own được duyệt.' using errcode='42501'; end if;
 if p_approve is null then raise exception 'Chọn đồng ý hoặc từ chối.'; end if;
 select * into req from public.approval_requests where id=p_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu.'; end if;
 if req.status<>'pending' then return req; end if;
 if not p_approve then
   update public.approval_requests set status='rejected',reviewer_id=auth.uid(),review_note=left(p_note,1000),reviewed_at=now() where id=p_id returning * into req;
   return req;
 end if;
 -- Inner subtransaction: any execution error rolls back all data changes.
 begin
   if not exists(select 1 from public.profiles where id=req.requester_id and role in ('admin','own') and is_active) then raise exception 'Người gửi không còn quyền admin.'; end if;
   case req.action
   when 'attendance_save' then
     select * into saved from public.admin_save_attendance(
       (req.payload->>'p_employee_id')::uuid,(req.payload->>'p_work_date')::date,
       (req.payload->>'p_check_in')::timestamptz,(req.payload->>'p_check_out')::timestamptz,
       req.reason,req.before_value);
   when 'attendance_delete' then
     if not public.attendance_ip_allowed() then raise exception 'Own cần IP được phép để duyệt xóa công.'; end if;
     select to_jsonb(a) into latest from public.attendance a where id=req.target_id for update;
     if latest is distinct from req.before_value then raise exception 'Công đã thay đổi. Gửi yêu cầu mới.'; end if;
     delete from public.attendance where id=req.target_id;
   when 'ip_add' then
     insert into public.ip_whitelist(network,label) values((req.payload->>'network')::cidr,req.payload->>'label');
   when 'ip_delete' then
     select to_jsonb(i) into latest from public.ip_whitelist i where id=req.target_id for update;
     if latest is distinct from req.before_value then raise exception 'IP đã thay đổi. Gửi yêu cầu mới.'; end if;
     delete from public.ip_whitelist where id=req.target_id;
   when 'profile_update' then
     select to_jsonb(p) into latest from public.profiles p where id=req.target_id for update;
     if latest is distinct from req.before_value or latest->>'role'='own' then raise exception 'Hồ sơ đã thay đổi hoặc là tài khoản own.'; end if;
     update public.profiles set full_name=req.payload->>'full_name',department=req.payload->>'department',role=(req.payload->>'role')::public.user_role,is_active=(req.payload->>'is_active')::boolean where id=req.target_id;
     if req.payload->>'role'<>'admin' or not (req.payload->>'is_active')::boolean then delete from public.admin_permissions where user_id=req.target_id; end if;
   when 'permission_change' then
     -- Lock profile as well to serialize permission and role changes.
     perform 1 from public.profiles where id=req.target_id and role='admin' and is_active for update;
     if not found then raise exception 'Tài khoản không còn là admin đang hoạt động.'; end if;
     select to_jsonb(p) into latest from public.admin_permissions p where user_id=req.target_id for update;
     if latest is distinct from req.before_value then raise exception 'Quyền đã thay đổi. Gửi yêu cầu mới.'; end if;
     insert into public.admin_permissions(user_id,can_create_employees) values(req.target_id,(req.payload->>'can_create_employees')::boolean)
     on conflict(user_id) do update set can_create_employees=excluded.can_create_employees;
   else raise exception 'Loại yêu cầu không hợp lệ.';
   end case;
 exception when others then
   get stacked diagnostics failure=message_text;
 end;
 update public.approval_requests set status=case when failure is null then 'applied' else 'failed' end,
 reviewer_id=auth.uid(),review_note=left(p_note,1000),error_message=failure,reviewed_at=now()
 where id=p_id returning * into req;
 return req;
end;
$$;
revoke all on function public.submit_approval(text,uuid,jsonb,text) from public;
revoke all on function public.review_approval(uuid,boolean,text) from public;
grant execute on function public.submit_approval(text,uuid,jsonb,text), public.review_approval(uuid,boolean,text) to authenticated;
commit;
-- Bootstrap only via SQL Editor, never from browser:
-- update public.profiles set role='own' where id='YOUR_EXISTING_USER_UUID';
