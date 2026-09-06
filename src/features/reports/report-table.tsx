import {Table,THead,TBody,TR,TH,TD} from "@/components/ui/table";
import type {ExportColumn} from "./export-data";
export function ReportTable({rows,columns}:{rows:Record<string,unknown>[];columns:ExportColumn[]}){
  if(!rows.length)return <p className="rounded-lg border border-border p-6 text-muted">No records match this report.</p>;
  return <Table><THead><TR>{columns.map(c=><TH key={c.key}>{c.label}</TH>)}</TR></THead><TBody>{rows.map((row,index)=><TR key={String(row.id??index)}>{columns.map(c=><TD key={c.key}>{row[c.key]===null||row[c.key]===undefined?"—":String(row[c.key])}</TD>)}</TR>)}</TBody></Table>;
}
