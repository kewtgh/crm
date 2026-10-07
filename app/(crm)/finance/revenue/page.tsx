import {requireCapability} from '@/lib/auth';
import {DataLoadError} from '@/components/data-state';
import {RevenueWorkspaceView} from '@/components/revenue-workspace';
import {loadRevenueWorkspace} from '@/lib/revenue-workspace-repository';
import {z} from 'zod';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 await requireCapability('revenue.recognition.view');
 const parsed=z.object({entity:z.uuid().optional(),contract:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).optional(),status:z.string().max(32).optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),q:z.string().max(80).optional()}).safeParse(await searchParams);
 if(!parsed.success)return <DataLoadError/>;
 const data=await loadRevenueWorkspace(parsed.data).catch(()=>null);
 return data?<RevenueWorkspaceView initial={data} contractId={parsed.data.contract}/>:<DataLoadError/>;
}
