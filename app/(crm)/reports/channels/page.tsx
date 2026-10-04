import {ChannelAnalyticsPage} from "@/components/channel-analytics-page";
import {WorkspaceTabs,reportTabs} from "@/components/workspace-tabs";
import {requireCapability} from "@/lib/auth";
import {channelAnalyticsFilters} from "@/lib/channel-analytics-input";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireCapability("education.view");const parsed=channelAnalyticsFilters.safeParse(await searchParams);return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/reports/channels"/><ChannelAnalyticsPage initialFilters={parsed.success?parsed.data:{}}/></div>;}
