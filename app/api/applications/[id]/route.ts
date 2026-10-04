import {GET as get,POST as post,PATCH as patch} from "../route";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){const {id}=await context.params,url=new URL(request.url);url.searchParams.set("id",id);return get(new Request(url,request),context);}
async function save(request:Request,context:Context){const {id}=await context.params,body=await request.json().catch(()=>({}));if(body.id&&body.id!==id)return new Response(JSON.stringify({code:"APPLICATION_INPUT_INVALID"}),{status:400,headers:{"content-type":"application/json"}});const next=new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify({...body,id})});return request.method==="PATCH"?patch(next,context):post(next,context);}
export const POST=save;export const PATCH=save;
