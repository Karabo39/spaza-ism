// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
import {POST} from "@/app/api/reports/email/route";
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),fetch:vi.fn()}));
vi.mock("@/lib/session",()=>({getSession:mock.session}));
vi.mock("@/lib/supabase/server",()=>({createClient:()=>({rpc:mock.rpc})}));
vi.mock("@/features/reports/export-data",()=>({reportFile:()=>Promise.resolve(new Blob(["report"]))}));
const store="00000000-0000-4000-8000-000000000001";
function request(overrides={}){return new Request("https://spaza.test/api/reports/email",{method:"POST",headers:{Origin:"https://spaza.test"},body:JSON.stringify({storeId:store,requestId:"00000000-0000-4000-8000-000000000002",recipient:"recipient@example.test",format:"xlsx",filename:"payments",title:"Payments",columns:[{key:"amount",label:"Amount"}],rows:[{amount:10}],...overrides})});}
beforeEach(()=>{mock.rpc.mockReset();mock.fetch.mockReset();mock.session.mockResolvedValue({activeStore:{id:store,name:"Shop",businessName:"Business",currency:"ZAR"},fullName:"Cashier"});vi.stubEnv("RESEND_API_KEY","test-key");vi.stubEnv("REPORT_EMAIL_FROM","Reports <reports@example.test>");vi.stubGlobal("fetch",mock.fetch);});
it("rejects cross-location report sends",async()=>{const res=await POST(request({storeId:"00000000-0000-4000-8000-000000000009"}));expect(res.status).toBe(403);expect(mock.fetch).not.toHaveBeenCalled();});
it("returns a clear configuration error without sending",async()=>{vi.stubEnv("RESEND_API_KEY","");const res=await POST(request());expect(res.status).toBe(503);expect(mock.fetch).not.toHaveBeenCalled();});
it("uses the same provider idempotency key to retry an uncertain email",async()=>{mock.rpc.mockImplementation(name=>Promise.resolve(name==="prepare_report_email"?{data:{id:"job",sent:false},error:null}:{error:null}));mock.fetch.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(Response.json({id:"provider"}));expect((await POST(request())).status).toBe(502);expect((await POST(request())).status).toBe(200);expect(mock.fetch.mock.calls.map(c=>c[1].headers["Idempotency-Key"])).toEqual(["report-job","report-job"]);expect(mock.rpc).toHaveBeenCalledWith("complete_report_email",{p_job:"job",p_provider:"provider"});});
it("does not resend an already recorded delivery",async()=>{mock.rpc.mockResolvedValue({data:{id:"job",sent:true},error:null});expect((await POST(request())).status).toBe(200);expect(mock.fetch).not.toHaveBeenCalled();});
