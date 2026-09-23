-- Run this file separately BEFORE owner-approvals.sql (enum value must commit first).
alter type public.user_role add value if not exists 'own';

-- Existing projects may still have the original text/check constraint.
do $$
begin
	if exists (
		select 1 from pg_constraint
		where conrelid = 'public.profiles'::regclass
			and conname = 'profiles_role_check'
	) then
		alter table public.profiles drop constraint profiles_role_check;
	end if;
end;
$$;

alter table public.profiles
	add constraint profiles_role_check check (role in ('own', 'admin', 'employee'));
