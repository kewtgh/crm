import { NotificationCenterPage } from "@/components/notification-center-page";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("nav.notifications","notifications.description");

export default async function Page(){
  await requireCapability("messages.view");
  const result=await listNotifications(1,10).catch(()=>null);
  return result
    ? <NotificationCenterPage initialItems={result.items} initialTotal={result.total}/>
    : <DataLoadError detailKey="nav.notification.loadFailed"/>;
}
