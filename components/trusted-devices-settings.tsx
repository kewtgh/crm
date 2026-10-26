"use client";
import Link from "next/link";
import {Eye,Laptop,MonitorSmartphone,RefreshCcw,ShieldCheck,Trash2,ChevronRight} from "lucide-react";
import {useTrustedDevices} from "@/hooks/use-trusted-devices";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {InlineMessage,StatusBadge} from "./ui";

export function TrustedDevicesSettings(){
 const {t}=useI18n(),{formatDate}=useUserPreferences(),state=useTrustedDevices(),notice=state.notice;
 return <div className="trusted-devices-settings">
  <div className="settings-section-heading"><p className="eyebrow">{t("eyebrow.privacyDevices")}</p><h2>{t("settings.privacyDevices")}</h2><p>{t("settings.privacyDevicesHelp")}</p></div>
  <section className="privacy-links"><Link href="/privacy-requests"><span><ShieldCheck size={18}/></span><div><b>{t("settings.privacyRequests")}</b><p>{t("settings.privacyRequestsHelp")}</p></div><ChevronRight size={16}/></Link><Link href="/privacy"><span><Eye size={18}/></span><div><b>{t("settings.privacyPolicy")}</b><p>{t("settings.privacyPolicyHelp")}</p></div><ChevronRight size={16}/></Link></section>
  <h3 className="device-heading">{t("personalSettings.devicesTitle")}</h3><p>{t("personalSettings.devicesHelp")}</p><InlineMessage type="warning">{t("settings.sessionPrivacyNote")}</InlineMessage>
  <button className="secondary-button" type="button" disabled={state.writing||state.loading} onClick={()=>void state.refresh()}><RefreshCcw size={16}/>{t("personalSettings.refresh")}</button>
  {state.loading&&<p role="status">{t("settings.devicesLoading")}</p>}
  {state.failed&&<InlineMessage type="error">{t("personalSettings.devicesFailed")}</InlineMessage>}
  {state.stale&&state.items!==null&&<p role="status">{t("personalSettings.stale")}</p>}
  {state.failed&&["accepted","device"].includes(notice?.kind??"")&&<InlineMessage type="warning">{t("personalSettings.refreshFailed")}</InlineMessage>}
  {notice&&<InlineMessage type={notice.kind==="accepted"||notice.kind==="device"?"success":"warning"}>{t(notice.kind==="accepted"?"settings.otherDevicesRevoked":notice.kind==="device"?"personalSettings.deviceForgotten":notice.kind==="partial"?"personalSettings.revokePartial":notice.kind==="missing"?"personalSettings.deviceMissing":"personalSettings.revokeUnknown",{sessions:t(notice.sessions?"personalSettings.confirmed":"personalSettings.unconfirmed"),devices:t(notice.devices?"personalSettings.confirmed":"personalSettings.unconfirmed")})}</InlineMessage>}
  <div className="device-list" aria-busy={state.loading||state.writing}>
   {!state.loading&&!state.stale&&state.items?.length===0&&<p role="status">{t("personalSettings.devicesEmpty")}</p>}
   {state.items?.map(device=><div className="device-row" key={device.id}><span><Laptop size={20}/></span><div><b>{device.label}</b><small>{t("settings.deviceLastUsed",{date:formatDate(device.lastUsedAt,{includeTime:true})})} · {t("settings.deviceExpires",{date:formatDate(device.expiresAt,{includeTime:true})})}</small></div>{device.current&&<StatusBadge tone="green">{t("settings.currentDevice")}</StatusBadge>}<button type="button" disabled={state.loading||state.stale||state.writing} onClick={()=>void state.revoke(device.id)} aria-label={t("settings.forgetDevice",{device:device.label})}><Trash2 size={16}/>{t("settings.forget")}</button></div>)}
  </div>
  <button className="danger-button" type="button" disabled={state.writing} onClick={()=>void state.revoke()}><MonitorSmartphone size={17}/>{t(state.writing?"common.processing":"settings.signOutOthers")}</button>
 </div>;
}
