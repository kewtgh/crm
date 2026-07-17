import { DataLoadError } from "@/components/data-state";
import { NotificationCenterPage } from "@/components/notification-center-page";
import { listNotifications } from "@/lib/notifications-repository";
export default async function Page(){const result=await listNotifications(1,10).catch(()=>null);return result?<NotificationCenterPage initialItems={result.items} initialTotal={result.total}/>:<DataLoadError detailKey="nav.notification.loadFailed"/>;}
