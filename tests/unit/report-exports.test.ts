// @vitest-environment node
import {expect,it} from "vitest";
import ExcelJS from "exceljs";
import {reportCsv,reportXlsx,reportPdf} from "@/features/reports/export-data";
const data={title:"Payment report",subtitle:"Shop · ZAR",columns:[{key:"name",label:"Customer"},{key:"amount",label:"Amount"}],rows:[{name:'=HYPERLINK("bad")',amount:-12.5},{name:"Milk, bread",amount:30}]};
it("escapes CSV formulas and preserves signed numeric values",()=>{const csv=reportCsv(data);expect(csv).toContain("'=HYPERLINK");expect(csv).toContain(",-12.5");expect(csv).toContain('"Milk, bread"');});
it("creates real Excel cells with text names and numeric amounts",async()=>{const buffer=await reportXlsx(data);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.getWorksheet("Report")!;expect(sheet.getCell("A5").value).toBe(data.rows[0].name);expect(sheet.getCell("B5").value).toBe(-12.5);expect(sheet.autoFilter).toBeTruthy();});
it("creates a paginated PDF for long reports",async()=>{const bytes=await reportPdf({...data,rows:Array.from({length:160},(_,n)=>({name:`Product ${n}`,amount:n}))});const text=Buffer.from(bytes).toString("latin1");expect(text.startsWith("%PDF")).toBe(true);expect(text).toContain("Product 159");expect((text.match(/\/Type \/Page\b/g)??[]).length).toBeGreaterThan(1);});
