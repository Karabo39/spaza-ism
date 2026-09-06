import {beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,renderHook} from "@testing-library/react";
import {useBillingAction} from "@/features/billing/use-billing-action";
const mock=vi.hoisted(()=>({online:true}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock("@/lib/offline/offline-context",()=>({useOffline:()=>({online:mock.online})}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:()=>Promise.resolve()})}));
beforeEach(()=>{cleanup();mock.online=true;});
it("retains retry identity after an uncertain response and renews after a confirmed payment",async()=>{
  const {result}=renderHook(()=>useBillingAction()); const payload={invoice:"i",amount:10};const first=result.current.request(payload);
  await act(()=>result.current.run(()=>Promise.reject(new Error("network")),"Paid"));
  expect(result.current.request(payload)).toBe(first);
  await act(()=>result.current.run(()=>Promise.resolve({error:null}),"Paid"));
  expect(result.current.request(payload)).not.toBe(first);
});
it("does not submit billing transactions offline",async()=>{
  mock.online=false;const {result}=renderHook(()=>useBillingAction());const action=vi.fn();
  await act(()=>result.current.run(action,"Done"));expect(action).not.toHaveBeenCalled();
});
