import {redirect} from "next/navigation";
import {getSession} from "@/lib/session";
import {createClient} from "@/lib/supabase/server";
import {PageHeader} from "@/components/shell/page-header";
import {DateFilter} from "@/features/reports/date-filter";
import {ExportButton} from "@/features/reports/export-button";
import {ReportTable} from "@/features/reports/report-table";
import {dateTime} from "@/lib/format";
export default async function UnpackingReport({searchParams}:{searchParams:Promise<{from?:string;to?:string}>}){
  const sp=await searchParams;const session=await getSession();if(!session?.activeStore)redirect("/onboarding");const db=await createClient();let query=db.from("bulk_unpackings").select("*").eq("store_id",session.activeStore.id);if(sp.from)query=query.gte("created_at",sp.from);if(sp.to)query=query.lte("created_at",`${sp.to}T23:59:59.999999`);const {data,error}=await query.order("created_at",{ascending:false}).limit(1000);if(error)throw error;const rows=(data??[]).map(r=>({...r,date:dateTime(r.created_at)}));const columns=[{key:"reference",label:"Reference"},{key:"pack_name",label:"Pack"},{key:"unit_name",label:"Unit product"},{key:"units_per_pack",label:"Ratio"},{key:"packs",label:"Packs removed"},{key:"units",label:"Units added"},{key:"date",label:"Date"},{key:"reason",label:"Reason"}];return <><PageHeader title="Unpacking Report" description="Linked bulk-pack decreases and unit-stock increases, with conversion and reason." crumbs={[{label:"Reports",href:"/reports"},{label:"Unpacking"}]} actions={<><DateFilter/><ExportButton rows={rows} columns={columns} filename="unpacking"/></>}/>{rows.length===1000&&<p className="text-warning">Latest 1,000 unpackings; narrow the date range for a complete report.</p>}<ReportTable rows={rows} columns={columns}/></>;
}
