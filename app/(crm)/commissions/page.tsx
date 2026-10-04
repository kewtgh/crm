import {requireCapability} from "@/lib/auth";
import {CommissionWorkspace} from "@/components/commission-workspace";
import {z} from "zod";
export default async function Page({searchParams}:{searchParams:Promise<{organization?:string}>}){await requireCapability("finance.view");const {organization}=await searchParams;return <CommissionWorkspace initialOrganization={z.uuid().safeParse(organization).success?organization:""}/>;}
