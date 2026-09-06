-- Run only after deploying the worker and configuring its secrets.
-- In Supabase Vault, create:
--   spaza_project_url = https://YOUR_PROJECT.supabase.co
--   spaza_notification_secret = same random value as NOTIFICATION_CRON_SECRET
-- Keep both values in Vault; do not commit real values in this file.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='spaza_project_url') or not exists(select 1 from vault.decrypted_secrets where name='spaza_notification_secret') then
    raise exception 'Configure notification Vault secrets before scheduling';
  end if;
end $$;
select cron.schedule('spaza-notifications','15 * * * *', $schedule$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='spaza_project_url')||'/functions/v1/scheduled-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-secret',(select decrypted_secret from vault.decrypted_secrets where name='spaza_notification_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  );
$schedule$);
