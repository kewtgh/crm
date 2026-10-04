import {databaseJson} from "./db/gateway";
import {channelAnalyticsFilters,type ChannelAnalytics,type ChannelAnalyticsFilters} from "./channel-analytics-input";
export function getChannelAnalytics(filters:ChannelAnalyticsFilters={},adapter=databaseJson){
 return adapter<ChannelAnalytics>("/db/rpc/channel_analytics",{method:"POST",body:JSON.stringify({p_filters:channelAnalyticsFilters.parse(filters)})});
}
