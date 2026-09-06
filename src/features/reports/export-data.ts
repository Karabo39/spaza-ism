export type ExportColumn={key:string;label:string};
export type ExportData={rows:Record<string,unknown>[];columns:ExportColumn[];title:string;subtitle?:string};
export function cellValue(value:unknown):string|number|boolean {
  if(value===null||value===undefined)return "";
  if(typeof value==="number")return Number.isFinite(value)?value:"";
  if(typeof value==="boolean")return value;
  return String(value);
}
export function reportCsv({rows,columns}:ExportData):string {
  const escape=(value:unknown)=>{const cell=cellValue(value);let text=String(cell);if(typeof cell==="string"&&/^[\s]*[=+\-@]/.test(text))text=`'${text}`;return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
  return "\ufeff"+[columns.map(c=>escape(c.label)).join(","),...rows.map(r=>columns.map(c=>escape(r[c.key])).join(","))].join("\r\n");
}
export async function reportXlsx(data:ExportData):Promise<ArrayBuffer>{
  const {default:ExcelJS}=await import("exceljs");const workbook=new ExcelJS.Workbook();workbook.creator="Spaza ISM";workbook.created=new Date();
  const sheet=workbook.addWorksheet("Report",{views:[{state:"frozen",ySplit:4}]});
  sheet.addRow([data.title]);sheet.addRow([data.subtitle??""]);sheet.addRow([]);sheet.addRow(data.columns.map(c=>c.label));
  sheet.getRow(1).font={bold:true,size:16,color:{argb:"FF182C4D"}};sheet.getRow(4).font={bold:true,color:{argb:"FFFFFFFF"}};sheet.getRow(4).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF182C4D"}};
  for(const row of data.rows)sheet.addRow(data.columns.map(c=>cellValue(row[c.key])));
  data.columns.forEach((column,index)=>{sheet.getColumn(index+1).width=Math.min(45,Math.max(16,column.label.length+4));sheet.getColumn(index+1).alignment={vertical:"top",wrapText:true};if(/amount|price|cost|value|total|paid|balance|credit|debit|outstanding/i.test(column.key))sheet.getColumn(index+1).numFmt='#,##0.00;[Red]-#,##0.00';});
  sheet.autoFilter={from:{row:4,column:1},to:{row:4,column:data.columns.length}};
  const buffer=await workbook.xlsx.writeBuffer();return new Uint8Array(buffer).buffer;
}
export async function reportPdf(data:ExportData):Promise<ArrayBuffer>{
  const [{jsPDF},{autoTable}]=await Promise.all([import("jspdf"),import("jspdf-autotable")]);
  const doc=new jsPDF({orientation:data.columns.length>5?"landscape":"portrait",unit:"mm",format:"a4"});
  doc.setFontSize(15);doc.text(data.title,14,16);doc.setFontSize(9);doc.text(data.subtitle??"",14,23,{maxWidth:doc.internal.pageSize.getWidth()-28});
  autoTable(doc,{startY:31,margin:{top:18,bottom:18},head:[data.columns.map(c=>c.label)],body:data.rows.map(r=>data.columns.map(c=>String(cellValue(r[c.key])).replaceAll("−","-"))),styles:{fontSize:8,cellPadding:2,overflow:"linebreak"},headStyles:{fillColor:[24,44,77]},alternateRowStyles:{fillColor:[243,246,249]},didDrawPage:()=>{doc.setFontSize(8);doc.text(`Spaza ISM · Page ${doc.getNumberOfPages()}`,14,doc.internal.pageSize.getHeight()-8);}});
  return doc.output("arraybuffer");
}
export async function reportFile(data:ExportData,format:"xlsx"|"pdf"|"csv"):Promise<Blob>{
  if(format==="xlsx")return new Blob([await reportXlsx(data)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  if(format==="pdf")return new Blob([await reportPdf(data)],{type:"application/pdf"});
  return new Blob([reportCsv(data)],{type:"text/csv;charset=utf-8"});
}
