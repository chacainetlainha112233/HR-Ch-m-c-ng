-- Read-only. Run in Supabase SQL Editor before upgrading a legacy project.
-- Does not expose emails, passwords, auth tokens or API keys.
select table_name,column_name,data_type,udt_name
from information_schema.columns
where table_schema='public' and table_name in
 ('profiles','attendance','departments','shift_assignments','leave_requests','overtime_requests','approval_requests','admin_permissions')
order by table_name,ordinal_position;

select role,count(*) as accounts from public.profiles group by role;

select tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in
 ('profiles','attendance','departments','shift_assignments','leave_requests','overtime_requests')
order by tablename,policyname;

select conrelid::regclass as table_name,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace='public'::regnamespace
and conrelid in ('public.profiles'::regclass,'public.attendance'::regclass);

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('is_admin','is_owner','can_read_profile','can_manage_employee','admin_update_user_access','manager_save_shift','manager_review_request','submit_approval','review_approval')
order by p.proname;
