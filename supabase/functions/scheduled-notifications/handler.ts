export type NotificationJob={id:string;recipient:string;payload:{kind:string;business:string;store:string;currency:string;count:number;rows?:Record<string,unknown>[];metrics?:Record<string,number>;from?:string;to?:string}};
export const notificationLabels:Record<string,string>={OUT_OF_STOCK:"Out of stock",UPCOMING_EXPIRY:"Upcoming expiry",STOCK_TAKE_COMPLETED:"Stock take completed",LOW_STOCK:"Low stock",WEEKLY_PROFIT:"Weekly profit",OVERDUE_INVOICES:"Overdue invoices"};
export function notificationMessage(job:NotificationJob){const p=job.payload;const label=notificationLabels[p.kind]??p.kind;const lines=[`${p.business} · ${p.store}`,label,""];
  if(p.metrics){lines.push(`${p.from} to ${p.to}`);const labels:Record<string,string>={sales:"Sales",returns:"Returns",net_sales:"Net sales",cost_of_goods:"Cost of goods",gross_profit:"Gross profit before overhead"};for(const [key,title] of Object.entries(labels))lines.push(`${title}: ${new Intl.NumberFormat("en-ZA",{style:"currency",currency:p.currency}).format(p.metrics[key]??0)}`);if(p.metrics.estimated_cost_movements>0)lines.push("Historical entries without a cost snapshot use the current product cost. Treat this as an estimate.");}
  else {lines.push(`${p.count} record${p.count===1?"":"s"}`);for(const row of p.rows??[])lines.push(Object.entries(row).map(([key,value])=>`${key.replaceAll("_"," ")}: ${value??"—"}`).join(" | "));if(p.count>(p.rows?.length??0))lines.push("Only the first 100 records are included. Open the app for all records.");}
  lines.push("","Manage these emails in Settings → Notification emails.");return {subject:`${p.store}: ${label}`,text:lines.join("\n")};
}
type Result<T>={data:T|null;error:{message:string}|null};
export type NotificationWorkerDependencies={secret:string;configured:boolean;claim:()=>PromiseLike<Result<unknown>>;complete:(id:string,sent:boolean,provider?:string,error?:string)=>PromiseLike<{error:{message:string}|null}>;send:(job:NotificationJob,message:{subject:string;text:string})=>Promise<{id:string}>;pause?:()=>Promise<void>};
export function notificationHandler(deps:NotificationWorkerDependencies){return async(request:Request)=>{
  if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
  if(!deps.configured||deps.secret.length<32)return Response.json({error:"Delivery configuration is incomplete"},{status:503});
  if(request.headers.get("x-notification-secret")!==deps.secret)return Response.json({error:"Unauthorized"},{status:401});
  const claimed=await deps.claim();if(claimed.error)return Response.json({error:"Could not claim due notifications"},{status:500});
  let sent=0,failed=0;for(const job of (claimed.data??[]) as NotificationJob[]){try{const result=await deps.send(job,notificationMessage(job));const completed=await deps.complete(job.id,true,result.id);if(completed.error)failed++;else sent++;}catch(error){failed++;await deps.complete(job.id,false,undefined,error instanceof Error?error.message:"Delivery failed");}await deps.pause?.();}
  return Response.json({sent,failed},{status:failed?502:200});
};}
