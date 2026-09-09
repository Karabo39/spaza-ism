vi.mock("@tanstack/react-query", () => ({useQuery: () => ({data:null})}));
import {beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {InvoiceWorkspace} from "@/features/billing/invoice-workspace";
import type {InvoiceBalance} from "@/lib/db/database.types";
const mock=vi.hoisted(()=>({online:true,manager:false,rpc:vi.fn()}));
vi.mock("@/lib/store-context",()=>({useStore:()=>({can:()=>mock.manager})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({rpc:mock.rpc})}));
vi.mock("@/features/billing/use-billing-action",()=>({useBillingAction:()=>({online:mock.online,busy:false,request:()=>"request",run:(action:()=>unknown)=>action()})}));
vi.mock("@/features/credit/override-approval",()=>({OverrideApproval:()=>null}));
vi.mock("@/features/reports/export-button",()=>({ExportButton:()=>null}));
vi.mock("@/features/billing/allocate-credit",()=>({AllocateCredit:()=>null}));
const invoice={id:"invoice",customer_id:"customer",customer_name:"Customer",reference:"INV-1",state:"ISSUED",status:"UNPAID",terms:"CASH",outstanding:100,total:100,paid:0,credits:0,debits:0,subtotal:100,discount:0,tax_percent:0,tax_amount:0,due_date:"2028-01-01",currency:"ZAR",salesperson:"Salesperson"} as InvoiceBalance;
beforeEach(()=>{cleanup();mock.online=true;mock.manager=false;mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:"payment",error:null});});
it("blocks unpaid cash goods release and posts a referenced partial card payment",async()=>{
  render(<InvoiceWorkspace invoice={invoice} items={[]} entries={[]} account={{balance:100,credit_limit:0}}/>);
  expect((screen.getByText("Release invoice goods") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("option",{name:"Credit note"})).toBeNull();
  fireEvent.change(screen.getByLabelText("Amount"),{target:{value:"40"}});
  fireEvent.change(screen.getByLabelText("Payment method"),{target:{value:"CARD_EFT"}});
  fireEvent.change(screen.getByLabelText("Card slip / payment reference"),{target:{value:"SLIP-4"}});
  fireEvent.click(screen.getByText("Record payment"));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith("post_invoice_entry",expect.objectContaining({p_invoice:"invoice",p_kind:"PAYMENT",p_amount:40,p_method:"CARD_EFT",p_reference:"SLIP-4",p_request:"request"})));
});
it("prevents offline invoice issuing",()=>{
  mock.online=false;render(<InvoiceWorkspace invoice={{...invoice,state:"DRAFT"}} items={[]} entries={[]} account={{balance:0,credit_limit:0}}/>);
  expect((screen.getByText("Issue invoice") as HTMLButtonElement).disabled).toBe(true);
});

vi.mock("@/features/billing/purchase-order", () => ({ PurchaseOrder: () => null }));
