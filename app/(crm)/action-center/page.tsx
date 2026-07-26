import { ActionCenterPage } from "@/components/action-center-page";
import { DataLoadError } from "@/components/data-state";
import { requireUser } from "@/lib/auth";
import { loadActionCenter } from "@/lib/action-center-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.actionCenter");}
export default async function Page(){const user=await requireUser();const snapshot=await loadActionCenter(user).catch(()=>null);return snapshot?<ActionCenterPage snapshot={snapshot}/>:<DataLoadError/>;}
