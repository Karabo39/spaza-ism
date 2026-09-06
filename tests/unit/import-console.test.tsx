import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportConsole } from "@/features/imports/import-console";
const mock=vi.hoisted(()=>({rpc:vi.fn(),online:true,can:true}));
vi.mock("@/lib/store-context",()=>({useStore:()=>({store:{id:"shop",businessId:"business",name:"Shop",businessName:"Business"},can:()=>mock.can})}));
vi.mock("@/lib/offline/offline-context",()=>({useOffline:()=>({online:mock.online})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({rpc:mock.rpc})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock("@/features/imports/import-format",()=>({importColumns:{products:["name","quantity"]},parseImport:()=>Promise.resolve([{name:"Soap",quantity:3}])}));
beforeEach(()=>{cleanup();mock.rpc.mockReset();mock.online=true;mock.can=true;});
it("requires preview confirmation and reuses the import request after an uncertain response",async()=>{
  const preview={ok:true,rows:[{id:"product",name:"Soap",action:"Create",row:2,quantity_before:0,quantity_after:3,input:{name:"Soap",quantity:3}}]};
  mock.rpc.mockResolvedValueOnce({data:preview,error:null}).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({data:preview,error:null});
  render(<ImportConsole/>);const file=new File(["workbook"],"products.xlsx");Object.defineProperty(file,"arrayBuffer",{value:()=>Promise.resolve(new ArrayBuffer(1))});
  fireEvent.change(screen.getByLabelText("Choose completed Excel template"),{target:{files:[file]}});
  const confirm=await screen.findByRole("button",{name:"Confirm 1 records"});expect(mock.rpc.mock.calls).toHaveLength(1);expect(mock.rpc.mock.calls[0][1].p_preview).toBe(true);
  fireEvent.click(confirm);await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(2));await waitFor(()=>expect((confirm as HTMLButtonElement).disabled).toBe(false));fireEvent.click(confirm);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(3));expect(mock.rpc.mock.calls[1][1].p_request).toBe(mock.rpc.mock.calls[2][1].p_request);
});
it("disables file review offline and hides import controls from cashiers",()=>{
  mock.online=false;const {unmount}=render(<ImportConsole/>);expect((screen.getByLabelText("Choose completed Excel template") as HTMLInputElement).disabled).toBe(true);unmount();mock.can=false;render(<ImportConsole/>);expect(screen.queryByLabelText("Choose completed Excel template")).toBeNull();
});
