-- Integration regression tests. Run in SQL Editor on a TEST project after all migrations.
-- Everything, including test users, is rolled back. Fails immediately on regression.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','owner-test@example.invalid','{"full_name":"Test Own"}'),
 ('10000000-0000-0000-0000-000000000002','admin-test@example.invalid','{"full_name":"Test Admin"}'),
 ('10000000-0000-0000-0000-000000000003','employee-test@example.invalid','{"full_name":"Test Employee"}');
update public.profiles set role='own' where id='10000000-0000-0000-0000-000000000001';
update public.profiles set role='admin' where id='10000000-0000-0000-0000-000000000002';
insert into public.ip_whitelist(network,label) values('203.0.113.231','approval test') on conflict(network) do nothing;
insert into public.attendance(id,employee_id,work_date,check_in) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',(now() at time zone 'Asia/Ho_Chi_Minh')::date,now()-interval '1 minute');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.headers','{"cf-connecting-ip":"203.0.113.231"}',true);
do $$ declare n integer; denied boolean=false; begin
 update public.profiles set role='own' where id=auth.uid(); get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL: admin can escalate role'; end if;
 update public.attendance set note='bypass' where id='20000000-0000-0000-0000-000000000001'; get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL: direct attendance mutation'; end if;
 delete from public.ip_whitelist where network='203.0.113.231'; get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL: direct IP delete'; end if;
 begin
  perform public.admin_save_attendance(null,null,null,null,'bypass',null);
 exception when insufficient_privilege then denied=true;
 end;
 if not denied then raise exception 'FAIL: old RPC remains executable'; end if;
end $$;
select set_config('test.approval_id',public.submit_approval('attendance_delete','20000000-0000-0000-0000-000000000001','{}','Test delete')::text,true);
do $$ declare denied boolean=false; begin
 if not exists(select 1 from public.attendance where id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL: submission already deleted data'; end if;
 begin perform public.review_approval(current_setting('test.approval_id')::uuid,true,'');
 exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL: admin approved own request'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare result public.approval_requests; begin
 result:=public.review_approval(current_setting('test.approval_id')::uuid,true,'Approved test');
 if result.status<>'applied' then raise exception 'FAIL: owner approval: %', result.error_message; end if;
 if exists(select 1 from public.attendance where id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL: approval did not apply deletion'; end if;
 result:=public.review_approval(result.id,true,'Retry');
 if result.status<>'applied' then raise exception 'FAIL: duplicate review not idempotent'; end if;
end $$;
-- Rejection leaves IP data unchanged.
select set_config('test.approval_id',public.submit_approval('ip_add',null,'{"network":"198.51.100.231","label":"reject-test"}','Test reject')::text,true);
do $$ declare result public.approval_requests; begin
 result:=public.review_approval(current_setting('test.approval_id')::uuid,false,'Rejected test');
 if result.status<>'rejected' then raise exception 'FAIL: rejection'; end if;
 if exists(select 1 from public.ip_whitelist where network='198.51.100.231') then raise exception 'FAIL: rejection changed IP data'; end if;
end $$;
-- Two proposals based on one snapshot: second must fail, not overwrite first.
select set_config('test.first',public.submit_approval('profile_update','10000000-0000-0000-0000-000000000003','{"full_name":"First","department":"HR","role":"employee","is_active":true}','First change')::text,true);
select set_config('test.second',public.submit_approval('profile_update','10000000-0000-0000-0000-000000000003','{"full_name":"Second","department":"HR","role":"employee","is_active":true}','Stale change')::text,true);
do $$ declare result public.approval_requests; begin
 result:=public.review_approval(current_setting('test.first')::uuid,true,'');
 if result.status<>'applied' then raise exception 'FAIL: first change'; end if;
 result:=public.review_approval(current_setting('test.second')::uuid,true,'');
 if result.status<>'failed' then raise exception 'FAIL: stale request overwrote data'; end if;
 if (select full_name from public.profiles where id='10000000-0000-0000-0000-000000000003')<>'First' then raise exception 'FAIL: failed request mutated data'; end if;
end $$;
-- Permission grant is itself approved.
select set_config('test.approval_id',public.submit_approval('permission_change','10000000-0000-0000-0000-000000000002','{"can_create_employees":true}','Grant creation')::text,true);
do $$ declare result public.approval_requests; begin
 result:=public.review_approval(current_setting('test.approval_id')::uuid,true,'');
 if result.status<>'applied' or not (select can_create_employees from public.admin_permissions where user_id='10000000-0000-0000-0000-000000000002') then raise exception 'FAIL: permission grant'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ declare denied boolean=false; begin
 if exists(select 1 from public.approval_requests) then raise exception 'FAIL: employee reads requests'; end if;
 begin perform public.submit_approval('ip_add',null,'{"network":"198.51.100.232"}','forbidden');
 exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL: employee submitted request'; end if;
end $$;
rollback;
