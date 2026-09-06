import {createClient} from "npm:@supabase/supabase-js@2.112.4";
import {notificationHandler} from "./handler.ts";
const key=Deno.env.get("RESEND_API_KEY");const sender=Deno.env.get("REPORT_EMAIL_FROM");const secret=Deno.env.get("NOTIFICATION_CRON_SECRET")??"";
const url=Deno.env.get("SUPABASE_URL")??"";const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const handler=notificationHandler({secret,configured:!!(key&&sender&&url&&serviceKey),
  claim:()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}).rpc("claim_notification_deliveries",{p_limit:10}),
  complete:(id,sent,provider,error)=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}).rpc("complete_notification_delivery",{p_delivery:id,p_sent:sent,p_provider:provider??null,p_error:error??null}),
  send:async(job,message)=>{const response=await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Idempotency-Key":`notification-${job.id}`},body:JSON.stringify({from:sender,to:[job.recipient],...message})});if(!response.ok)throw new Error(`Email provider status ${response.status}`);return await response.json();},
  pause:()=>new Promise(resolve=>setTimeout(resolve,600)),
});
Deno.serve(handler);
