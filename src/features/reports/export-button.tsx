"use client";
import {useId,useRef,useState} from "react";
import {Download,Mail} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {useStore} from "@/lib/store-context";
import {reportFile,type ExportColumn} from "./export-data";
export function ExportButton({rows,columns,filename}:{rows:Record<string,unknown>[];columns:ExportColumn[];filename:string}){
  const {store}=useStore();const id=useId();const [format,setFormat]=useState<"xlsx"|"pdf"|"csv">("xlsx");const [busy,setBusy]=useState(false);const [emailOpen,setEmailOpen]=useState(false);const [recipient,setRecipient]=useState("");const request=useRef<{key:string;id:string}|null>(null);
  const title=filename.replaceAll("-"," ");const filtered=rows.map(row=>Object.fromEntries(columns.map(c=>[c.key,row[c.key]??""])));
  const data={rows:filtered,columns,title,subtitle:`${store.businessName??"Spaza ISM"} · ${store.name} · ${store.currency??"ZAR"}`};
  async function download(){setBusy(true);try{const blob=await reportFile(data,format);const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${filename}.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{toast.error("Could not prepare the report. Please try again.");}finally{setBusy(false);}}
  async function send(){setBusy(true);const payload={...data,filename,format,recipient,storeId:store.id};const key=JSON.stringify(payload);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};try{const response=await fetch("/api/reports/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,requestId:request.current.id})});const result=await response.json();if(!response.ok)throw new Error(result.error??"Could not send report.");toast.success("Report email sent.");setEmailOpen(false);request.current=null;}catch(error){toast.error(error instanceof Error?error.message:"Could not confirm email delivery. Retry with the same details.");}finally{setBusy(false);}}
  return <><div className="flex items-center gap-1.5"><select aria-label="Export format" className="h-9 rounded-md border border-border bg-input px-2 text-sm" value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="xlsx">Excel</option><option value="pdf">PDF</option><option value="csv">CSV</option></select><Button size="sm" variant="secondary" loading={busy} disabled={!rows.length} onClick={download}><Download className="size-4"/>Export</Button><Button size="sm" variant="secondary" disabled={!rows.length||busy} onClick={()=>setEmailOpen(true)}><Mail className="size-4"/>Email</Button></div>
    <Dialog open={emailOpen} onOpenChange={setEmailOpen}><DialogContent><DialogHeader><DialogTitle>Email report</DialogTitle><DialogDescription>Send the {rows.length} rows currently shown in this report as a {format.toUpperCase()} attachment.</DialogDescription></DialogHeader><Label htmlFor={id}>Recipient email</Label><Input id={id} type="email" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="name@example.com"/><p className="text-sm text-muted">{title} · {store.name}</p><Button loading={busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)} onClick={send}>Send report</Button></DialogContent></Dialog>
  </>;
}
