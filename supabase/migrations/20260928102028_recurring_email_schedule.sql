
-- Hosting configuration for this application's Supabase project. No secret is stored
-- in source or migration history: Vault generates and encrypts the worker secret.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_net') and to_regclass('vault.secrets') is not null then
  create extension if not exists pg_net;
  if not exists(select 1 from vault.secrets where name='pos_recurring_worker_secret') then
   perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'pos_recurring_worker_secret','Authentication for the recurring invoice email worker');
  end if;
  perform cron.schedule('recurring-invoice-email','*/10 * * * *',$job$
   select net.http_post(
    url:='https://uagswjbtipvlyeychfyb.supabase.co/functions/v1/recurring-invoices',
    headers:=jsonb_build_object('Content-Type','application/json','x-recurring-secret',(select decrypted_secret from vault.decrypted_secrets where name='pos_recurring_worker_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
  $job$);
 end if;
end $$;
