-- After creating your first account, replace the email below and run:
-- This makes that account the Primary Admin.
update public.user_roles
set role='primary_admin'
where user_id=(select id from auth.users where email='YOUR_EMAIL_HERE');