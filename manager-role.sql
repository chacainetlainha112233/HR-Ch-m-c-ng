-- Run this query first and wait for Success before running manager-ops.sql.
alter type public.user_role add value if not exists 'manager';