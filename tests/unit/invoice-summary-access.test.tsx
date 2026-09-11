import {afterEach,expect,it,vi} from "vitest";
import "@testing-library/jest-dom/vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {InvoiceSummary} from "@/features/billing/invoice-summary";
import {modulePermissions} from "@/lib/modules";
const rpc=vi.hoisted(()=>vi.fn().mockResolvedValue({data:{invoiced:100,paid:50,outstanding:50},error:null}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc})}));
vi.mock("next/link",()=>({default:({children,href}: {children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
afterEach(()=>{cleanup();rpc.mockClear();});
it("does not fetch a disabled summary",async()=>{
 expect(await InvoiceSummary({storeId:"s",currency:"ZAR",permissions:modulePermissions("employee",{invoices_summary:false})})).toBeNull();expect(rpc).not.toHaveBeenCalled();
});
it("renders only enabled totals and hides the invoice navigation when denied",async()=>{
 render(await InvoiceSummary({storeId:"s",currency:"ZAR",permissions:modulePermissions("employee",{invoices_paid:false,invoices_view_invoices:false})}));
 expect(screen.getByText("Invoiced")).toBeInTheDocument();expect(screen.getByText("Outstanding")).toBeInTheDocument();expect(screen.queryByText("Paid / allocated")).not.toBeInTheDocument();expect(screen.queryByRole("link",{name:"View invoices"})).not.toBeInTheDocument();expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
});
