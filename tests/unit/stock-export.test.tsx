import {beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {StockExport} from "@/features/stock/stock-export";
const mock=vi.hoisted(()=>({rows:[] as Record<string,unknown>[]}));
vi.mock("@/lib/store-context",()=>({useStore:()=>({store:{id:"store",name:"Shop"}})}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:{rows:Array.from({length:24},(_,i)=>({name:`Product ${i}`,is_active:true})),generated:"2026-09-07"}})}));
vi.mock("@/features/reports/export-button",()=>({ExportButton:({rows}:{rows:Record<string,unknown>[]})=>{mock.rows=rows;return null;}}));
beforeEach(cleanup);
it("exports all matches by default and supports an explicit current-page scope",()=>{
 render(<StockExport status="low" search="water" currentRows={[{name:"Page item",is_active:true}]}/>);
 expect(mock.rows).toHaveLength(24);expect(mock.rows[0]).toMatchObject({store:"Shop",filter:"low",search:"water"});
 fireEvent.change(screen.getByLabelText("Export scope"),{target:{value:"page"}});expect(mock.rows).toHaveLength(1);expect(mock.rows[0].name).toBe("Page item");
});
