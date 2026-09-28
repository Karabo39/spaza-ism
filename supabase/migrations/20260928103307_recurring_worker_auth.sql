-- The Edge worker validates its cron credential without exporting the Vault secret.
-- Only the server's service role can ask for validation; no secret is ever returned.
create function public.authenticate_recurring_worker(p_secret text) returns boolean
language plpgsql security definer set search_path='' as $$
declare valid boolean;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or to_regclass('vault.decrypted_secrets') is null then return false;end if;
 execute 'select extensions.digest(decrypted_secret,''sha256'')=extensions.digest($1,''sha256'') from vault.decrypted_secrets where name=''pos_recurring_worker_secret''' into valid using p_secret;
 return coalesce(valid,false);
end $$;
revoke all on function public.authenticate_recurring_worker(text) from public,anon,authenticated;
grant execute on function public.authenticate_recurring_worker(text) to service_role;
