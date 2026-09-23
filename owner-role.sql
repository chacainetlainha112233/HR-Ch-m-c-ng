-- Run this file separately BEFORE owner-approvals.sql (enum value must commit first).
alter type public.user_role add value if not exists 'own';
