"use client";
import {WorkspaceHeading} from "./workspace-heading";

import { BilingualNameHint, DateInput } from "@/components/structured-inputs";
/* eslint-disable @next/next/no-img-element -- private avatar and MFA QR images are served by authenticated endpoints. */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Camera, Check, ChevronRight, Copy, Download, Eye, KeyRound, Languages, LockKeyhole, Mail, RefreshCcw, Save, ShieldCheck, UserRound } from "lucide-react";
import { ConfirmDialog, InlineMessage, SearchableSelect, StatusBadge, Toast } from "@/components/ui";
import { useAppUser } from "@/components/app-user-context";
import type { AppUser } from "@/lib/user";
import type { Locale } from "@/lib/i18n";
import type { NotificationPreferences, UserSettings } from "@/lib/settings-repository";
import { roleMessageKey } from "@/lib/roles";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { passwordValueSchema } from "@/lib/validation";
import { MfaAuthenticatorGuide } from "./mfa-authenticator-guide";
import { isSupportedTimezone } from "@/lib/timezone";
import {accountSaveSchema,mfaReadSchema,notificationSettingsSchema,preferencePreview,settingsReadSchema} from "@/lib/settings-contract";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {TrustedDevicesSettings} from "./trusted-devices-settings";

const tabs = [
  { href: "/settings/profile", key: "settings.profile", icon: UserRound }, { href: "/settings/account", key: "settings.accountLanguage", icon: Languages },
  { href: "/settings/notifications", key: "settings.notifications", icon: BellRing }, { href: "/settings/security", key: "settings.security", icon: ShieldCheck }, { href: "/settings/privacy", key: "settings.privacy", icon: Eye },
];

const defaultNotifications: NotificationPreferences = { tasks: { email: true, inApp: true }, relationship: { email: true, inApp: true }, sales: { email: false, inApp: true }, security: { email: true, inApp: true } };
function fallbackSettings(user: AppUser): UserSettings { return { username: user.username, displayNameZh: user.displayNameZh, displayNameEn: user.displayName, honorific: "", bio: "", avatarPath: null, locale: "zh-CN", timezone: "Asia/Taipei", dateFormat: "yyyy-MM-dd", quietHoursStart: null, quietHoursEnd: null, notifications: defaultNotifications }; }

export function SettingsPage({ section }: { section: string }) {
  const { t } = useI18n(); const pathname = usePathname(); const user = useAppUser();
  const [settings, setSettings] = useState(() => fallbackSettings(user)); const [email, setEmail] = useState(user.email); const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading"); const [loadAttempt, setLoadAttempt] = useState(0); const [toast, setToast] = useState("");
  const {setPreferences}=useUserPreferences();
  const needsPreferences=section!=="security"&&section!=="privacy";
  useEffect(()=>{
    if(!needsPreferences)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{setLoadState("loading");void apiFetch<unknown>("/api/settings",{signal:controller.signal}).then(value=>{
      const result=settingsReadSchema.parse(value);if(!controller.signal.aborted){setSettings(result.settings);setEmail(result.email);setPreferences({timezone:result.settings.timezone,dateFormat:result.settings.dateFormat});setLoadState("ready");}
    }).catch(()=>{if(!controller.signal.aborted)setLoadState("error");});},0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[loadAttempt,needsPreferences,setPreferences,user.email]);
  const persist=async(body:unknown,successKey:string)=>{
    const result=await apiFetch<{ok?:boolean}>("/api/settings",{method:"PATCH",body:JSON.stringify(body)});
    if(typeof body==="object"&&body!==null&&"section" in body&&body.section==="account")accountSaveSchema.parse(result);
    else if(result.ok!==true)throw new Error("SETTINGS_RESPONSE_INVALID");
    setToast(t(successKey));return result;
  };
  return <div className="page-stack settings-page"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.personalSettings")}</p><WorkspaceHeading>{t("settings.title")}</WorkspaceHeading><p>{t("settings.description")}</p></div><StatusBadge tone={user.accountStatus === "ACTIVE" ? "green" : "amber"}>{t("settings.accountNormal")}</StatusBadge></section><div className="settings-layout"><aside className="settings-nav">{tabs.map(({ href, key, icon: Icon }) => <Link key={href} className={pathname === href ? "active" : ""} aria-current={pathname===href?"page":undefined} href={href}><Icon size={17} /><span>{t(key)}</span><ChevronRight size={14} /></Link>)}<div className="settings-role-note"><LockKeyhole size={17} /><div><b>{t("settings.protected")}</b><p>{t("settings.protectedHelp")}</p></div></div></aside><section className="settings-content">{needsPreferences && loadState === "loading" && <InlineMessage type="warning">{t("settings.loading")}</InlineMessage>}{needsPreferences && loadState === "error" && <div className="settings-load-error"><InlineMessage type="error">{t("settings.loadFailed")}</InlineMessage><button className="secondary-button" type="button" onClick={() => {setLoadState("loading");setLoadAttempt((value) => value + 1);}}>{t("common.retry")}</button></div>}{!needsPreferences && <>{section === "security" && <SecuritySettings />}{section === "privacy" && <TrustedDevicesSettings />}</>}{needsPreferences && loadState === "ready" && <>{section === "profile" && <ProfileSettings user={user} settings={settings} setSettings={setSettings} persist={persist} />}{section === "account" && <AccountSettings user={user} email={email} settings={settings} setSettings={setSettings} setEmail={setEmail} persist={persist} />}{section === "notifications" && <NotificationSettings settings={settings} setSettings={setSettings} persist={persist} />}</>}</section></div>{toast && <Toast message={toast} onClose={() => setToast("")} />}</div>;
}

const settingsEyebrowKeys: Record<string, string> = { PROFILE: "eyebrow.profile", ACCOUNT: "eyebrow.accountLanguage", NOTIFICATIONS: "eyebrow.notifications", SECURITY: "eyebrow.passwordSecurity", PRIVACY: "eyebrow.privacyDevices" };
function SettingsHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { const { t } = useI18n(); return <div className="settings-section-heading"><p className="eyebrow">{t(settingsEyebrowKeys[eyebrow] ?? eyebrow)}</p><h2>{title}</h2><p>{description}</p></div>; }
type Setter = React.Dispatch<React.SetStateAction<UserSettings>>;
type Persist = (body: unknown, successKey: string) => Promise<unknown>;

function ProfileSettings({ user, settings, setSettings, persist }: { user: AppUser; settings: UserSettings; setSettings: Setter; persist: Persist }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState("");
  const [file, setFile] = useState<File>();
  const [avatarError, setAvatarError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const avatarSource = avatar || (settings.avatarPath ? `/api/settings/avatar?v=${encodeURIComponent(settings.avatarPath)}` : "");

  useEffect(() => () => {
    if (avatar.startsWith("blob:")) URL.revokeObjectURL(avatar);
  }, [avatar]);

  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (!next) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size > 5 * 1024 * 1024) {
      event.currentTarget.value = "";
      setFile(undefined);
      setAvatar("");
      setAvatarError(t("settings.avatarInvalid"));
      return;
    }
    setAvatarError("");
    setFile(next);
    setAvatar(URL.createObjectURL(next));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      if (file) {
        const data = new FormData();
        data.set("avatar", file);
        const result = await apiFetch<{ url?: string }>("/api/settings/avatar", { method: "POST", body: data });
        setAvatar(result.url ?? "/api/settings/avatar");
        window.dispatchEvent(new CustomEvent("lumina:avatar-updated", { detail: { url: result.url ?? "/api/settings/avatar" } }));
        setFile(undefined);
      }
      await persist({ section: "profile", displayNameZh: settings.displayNameZh, displayNameEn: settings.displayNameEn, honorific: settings.honorific, bio: settings.bio }, "settings.profileSaved");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "INVALID_AVATAR") {
        setAvatar("");
        setFile(undefined);
        setAvatarError(t("settings.avatarInvalid"));
      } else {
        setFormError(presentApiError(caught, t, "settings.saveFailed").message);
      }
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={submit}><SettingsHeader eyebrow="PROFILE" title={t("settings.profile")} description={t("settings.profileDescription")} /><div className="avatar-editor"><span className="large-avatar">{avatarSource ? <img src={avatarSource} alt={t("settings.avatarPreview")} /> : user.initials}</span><div><b>{t("settings.avatar")}</b><p>{t("settings.avatarHelp")}</p><button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Camera size={16} />{t("settings.changeAvatar")}</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} /></div></div>{avatarError && <InlineMessage type="error">{avatarError}</InlineMessage>}<div className="form-grid two-column"><label className="field"><span>{t("settings.nameZh")}</span><input name="displayNameZh" value={settings.displayNameZh} onChange={(event) => setSettings((current) => ({ ...current, displayNameZh: event.target.value }))} /></label><label className="field"><span>{t("settings.nameEn")}</span><input name="displayNameEn" value={settings.displayNameEn} onChange={(event) => setSettings((current) => ({ ...current, displayNameEn: event.target.value }))} /></label><BilingualNameHint/></div><SearchableSelect label={t("settings.honorific")} options={[{ value: "ms", label: "Ms." }, { value: "mr", label: "Mr." }, { value: "dr", label: "Dr." }, { value: "mx", label: "Mx." }]} value={settings.honorific || "ms"} onChange={(honorific) => setSettings((current) => ({ ...current, honorific }))} /><label className="field"><span>{t("settings.bio")}</span><textarea rows={4} value={settings.bio} onChange={(event) => setSettings((current) => ({ ...current, bio: event.target.value }))} /></label><ProtectedFields user={user} />{formError && <InlineMessage type="error">{formError}</InlineMessage>}<SaveRow saving={saving} /></form>;
}

function ProtectedFields({ user }: { user: AppUser }) { const { t } = useI18n(); return <div className="protected-field-grid"><div><span>{t("settings.role")}</span><b>{t(roleMessageKey[user.role])}</b><small>{t("settings.immutable")}</small></div><div><span>{t("settings.verificationLevel")}</span><b>{t(user.aal==="aal2"?"settings.highPrivilege":"settings.byRole")} · {t(user.mfaEnabled ? "nav.mfaEnabled" : "nav.mfaNotEnabled")}</b><small>{t("settings.immutable")}</small></div><div><span>{t("settings.accountStatus")}</span><b className="good-text">{t("settings.activeVerified")}</b><small>{t("settings.immutable")}</small></div></div>; }

function AccountSettings({ user, email, setEmail, settings, setSettings, persist }: { user: AppUser; email: string; setEmail: (value: string) => void; settings: UserSettings; setSettings: Setter; persist: Persist }) {
  const {locale,setLocale,t}=useI18n(),{setPreferences}=useUserPreferences();
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false),inFlight=useRef(false);
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(inFlight.current)return;inFlight.current=true;setSaving(true);setError("");setNotice("");
    const snapshot={section:"account",email,locale:settings.locale,timezone:settings.timezone,dateFormat:settings.dateFormat};let accepted=false;
    try{
      const result=accountSaveSchema.parse(await persist(snapshot,"settings.accountSaved"));accepted=true;
      setNotice(result.emailVerification==="UNCONFIRMED"?"personalSettings.emailUnconfirmed":result.emailVerification==="SENT"?"personalSettings.emailSent":"");
      setPreferences({timezone:snapshot.timezone,dateFormat:snapshot.dateFormat});await setLocale(snapshot.locale);
    }catch(caught){setError(accepted?t("personalSettings.displayFailed"):isDefinitiveMutationFailure(caught)?presentApiError(caught,t,"settings.saveFailed").message:t("personalSettings.saveUnknown"));}
    finally{inFlight.current=false;setSaving(false);}
  };
  const emailIsVerified=email.trim().toLowerCase()===user.email.trim().toLowerCase()&&user.emailVerified,instant=new Date();
  return <form onSubmit={submit}><fieldset className="settings-edit-fields" disabled={saving}>
    <SettingsHeader eyebrow="ACCOUNT" title={t("settings.accountLanguage")} description={t("settings.languageHelp")}/>
    <div className="form-grid two-column"><label className="field"><span>{t("settings.username")}</span><input value={settings.username} readOnly aria-readonly="true"/></label><label className="field"><span>{t("settings.internalId")}</span><input value={user.id} readOnly aria-readonly="true"/><small className="field-help">{t("settings.internalIdHelp")}</small></label></div>
    <label className="field"><span>{t("settings.loginEmail")}</span><span className="input-with-status"><Mail size={17}/><input name="email" type="email" value={email} onChange={event=>setEmail(event.target.value)} required/><b><Check size={14}/>{t(emailIsVerified?"nav.emailVerified":"settings.pendingVerification")}</b></span></label><InlineMessage type="warning">{t("settings.emailWarning")}</InlineMessage>
    <div className="form-grid two-column"><SearchableSelect label={t("settings.language")} required options={[{value:"zh-CN",label:"简体中文"},{value:"en",label:"English"}]} value={settings.locale||locale} onChange={value=>setSettings(current=>({...current,locale:value as Locale}))}/><SearchableSelect label={t("settings.timezone")} required options={[{value:"Asia/Taipei",label:"Asia/Taipei (UTC+8)"},{value:"Asia/Shanghai",label:"Asia/Shanghai (UTC+8)"},{value:"Asia/Singapore",label:"Asia/Singapore (UTC+8)"},{value:"Europe/London",label:"Europe/London"},{value:"America/New_York",label:"America/New_York"}]} value={settings.timezone} onChange={timezone=>{if(isSupportedTimezone(timezone))setSettings(current=>({...current,timezone}));}}/></div>
    <label className="field"><span>{t("settings.dateFormat")}</span><select name="dateFormat" value={settings.dateFormat} onChange={event=>setSettings(current=>({...current,dateFormat:event.target.value as UserSettings["dateFormat"]}))}>{["yyyy-MM-dd","dd/MM/yyyy","MM/dd/yyyy"].map(format=><option key={format} value={format}>{preferencePreview(settings.timezone,format,instant).split(" ")[0]}</option>)}</select></label>
    <section className="settings-preference-preview"><b>{t("personalSettings.preview")}</b><output data-preference-preview aria-live="polite">{preferencePreview(settings.timezone,settings.dateFormat,instant)} · {settings.timezone}</output><small>{t("personalSettings.previewHelp")}</small></section>
    {notice&&<InlineMessage type={notice==="personalSettings.emailUnconfirmed"?"warning":"success"}>{t(notice)}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}<SaveRow saving={saving}/>
  </fieldset>{user.role.startsWith("SALES_")&&<TeamMembershipSettings/>}</form>;
}

type SelfTeamOverview={teams:Array<{id:string;code:string;nameZh:string;nameEn:string}>;memberships:Array<{teamId:string;nameZh:string;nameEn:string;role:"MEMBER"|"LEAD";status:"PENDING"|"ACTIVE"|"REJECTED"}>};
function TeamMembershipSettings(){
  const{t}=useI18n();const[data,setData]=useState<SelfTeamOverview|null>(null);const[pending,setPending]=useState("");const[error,setError]=useState("");
  useEffect(()=>{let active=true;void apiFetch<SelfTeamOverview>("/api/team-memberships").then(result=>{if(active)setData(result);}).catch(()=>{if(active)setError(t("admin.teams.membershipsLoadFailed"));});return()=>{active=false;};},[t]);
  const request=async(teamId:string)=>{setPending(teamId);setError("");try{setData(await apiFetch<SelfTeamOverview>("/api/team-memberships",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({teamId})}));}catch{setError(t("admin.teams.requestFailed"));}finally{setPending("");}};
  return <section className="settings-subform team-membership-settings"><h3>{t("admin.teams.myTeams")}</h3><p>{t("admin.teams.requestHelp")}</p>{data?.teams.map(team=>{const membership=data.memberships.find(item=>item.teamId===team.id);return <article key={team.id}><span><b>{team.nameZh} / {team.nameEn}</b><small>{team.code}{membership?.role==="LEAD"?` · ${t("admin.teams.leadBadge")}`:""}</small></span>{membership?.status==="ACTIVE"?<StatusBadge tone="green">{t("admin.teams.membership.active")}</StatusBadge>:membership?.status==="PENDING"?<StatusBadge tone="amber">{t("admin.teams.membership.pending")}</StatusBadge>:<button className="secondary-button compact" type="button" disabled={pending===team.id} onClick={()=>void request(team.id)}>{pending===team.id?t("common.processing"):t("admin.teams.requestJoin")}</button>}</article>;})}{!data&&!error&&<p role="status">{t("common.loading")}</p>}{error&&<InlineMessage type="error">{error}</InlineMessage>}</section>;
}

function NotificationSettings({ settings, setSettings, persist }: { settings: UserSettings; setSettings: Setter; persist: Persist }) {
  const { t } = useI18n(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const rows = ["tasks", "relationship", "sales", "security"];
  const inFlight=useRef(false);
  const updateChannel = (key: string, channel: "email" | "inApp", value: boolean) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, [key]: { ...(current.notifications[key] ?? { email: false, inApp: false }), [channel]: value } } }));
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(inFlight.current)return;setError("");
    const parsed=notificationSettingsSchema.safeParse({section:"notifications",notifications:settings.notifications,quietHoursStart:settings.quietHoursStart,quietHoursEnd:settings.quietHoursEnd});
    if(!parsed.success){setError(t(parsed.error.issues.some(issue=>issue.message==="SECURITY_NOTIFICATION_REQUIRED")?"personalSettings.securityRequired":"personalSettings.quietInvalid"));return;}
    inFlight.current=true;setSaving(true);
    try{await persist(parsed.data,"settings.notificationSaved");}catch(caught){setError(isDefinitiveMutationFailure(caught)?presentApiError(caught,t,"settings.saveFailed").message:t("personalSettings.saveUnknown"));}finally{inFlight.current=false;setSaving(false);}
  };
  return <form onSubmit={submit}><fieldset className="settings-edit-fields" disabled={saving}><SettingsHeader eyebrow="NOTIFICATIONS" title={t("settings.notifications")} description={t("settings.notificationHelp")} /><div className="notification-settings-head"><span>{t("settings.notificationType")}</span><span>{t("settings.emailChannel")}</span><span>{t("settings.inApp")}</span></div>{rows.map((key) => {
    const channels = settings.notifications[key] ?? { email: false, inApp: false };
    const policyId = key === "security" ? "security-notification-policy" : undefined;
    return <div className="notification-setting-row" key={key}><div><b>{t(`settings.notify.${key}`)}</b><small id={policyId}>{t(`settings.notify.${key}Help`)}</small></div><label className="switch"><input aria-label={`${t(`settings.notify.${key}`)} · ${t("settings.emailChannel")}`} aria-describedby={policyId} type="checkbox" checked={channels.email} disabled={key === "security" && channels.email && !channels.inApp} onChange={(event) => updateChannel(key, "email", event.target.checked)} /><span /></label><label className="switch"><input aria-label={`${t(`settings.notify.${key}`)} · ${t("settings.inApp")}`} aria-describedby={policyId} type="checkbox" checked={channels.inApp} disabled={key === "security" && channels.inApp && !channels.email} onChange={(event) => updateChannel(key, "inApp", event.target.checked)} /><span /></label></div>;
  })}<QuietHoursFields settings={settings} setSettings={setSettings}/>{error && <InlineMessage type="error">{error}</InlineMessage>}<SaveRow saving={saving} /></fieldset></form>;
}

function QuietHoursFields({settings,setSettings}:{settings:UserSettings;setSettings:Setter}){
 const {t}=useI18n();
 const preset=settings.quietHoursStart==="22:00:00"&&settings.quietHoursEnd==="08:00:00"?"22:00":settings.quietHoursStart==="21:00:00"&&settings.quietHoursEnd==="09:00:00"?"21:00":settings.quietHoursStart===null&&settings.quietHoursEnd===null?"off":"custom";
 const [custom,setCustom]=useState(preset==="custom"),mode=custom?"custom":preset;
 const start=settings.quietHoursStart??"",end=settings.quietHoursEnd??"",valid=notificationSettingsSchema.safeParse({section:"notifications",notifications:settings.notifications,quietHoursStart:start,quietHoursEnd:end}).success;
 return <section className="settings-quiet-hours"><label className="field"><span>{t("personalSettings.quietMode")}</span><select name="quietMode" value={mode} onChange={event=>{const next=event.target.value;setCustom(next==="custom");setSettings(current=>({...current,quietHoursStart:next==="off"?null:next==="custom"?current.quietHoursStart??"22:00:00":next+":00",quietHoursEnd:next==="off"?null:next==="custom"?current.quietHoursEnd??"08:00:00":next==="22:00"?"08:00:00":"09:00:00"}));}}><option value="off">{t("settings.off")}</option><option value="22:00">22:00–08:00</option><option value="21:00">21:00–09:00</option><option value="custom">{t("personalSettings.quietCustom")}</option></select></label>
  {mode==="custom"&&<div className="form-grid two-column"><label className="field"><span>{t("personalSettings.quietStart")}</span><DateInput name="quietHoursStart" type="time" step="1" required value={start} onChange={event=>setSettings(current=>({...current,quietHoursStart:event.target.value}))}/></label><label className="field"><span>{t("personalSettings.quietEnd")}</span><DateInput name="quietHoursEnd" type="time" step="1" required value={end} onChange={event=>setSettings(current=>({...current,quietHoursEnd:event.target.value}))}/></label></div>}
  <p className="field-help">{t("personalSettings.quietHelp",{timezone:settings.timezone})}</p>{mode!=="off"&&valid&&<p role="status">{t(start>end?"personalSettings.quietOvernight":"personalSettings.quietSameDay",{start:start.slice(0,5),end:end.slice(0,5),timezone:settings.timezone})}</p>}
 </section>;
}

type Factor = { id: string; status: string; friendly_name?: string };
function SecuritySettings() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useAppUser();
  const [mfaError, setMfaError] = useState("");
  const [mfaSuccess, setMfaSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<{ factorId: string; challengeId: string; qrCode: string; secret?: string }>();
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState<number|null>(null);
  const [mfaReadState,setMfaReadState]=useState<"loading"|"ready"|"error">("loading"),runMfaRead=useRemoteSearch();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const passwordChangeInFlight = useRef(false);

  const loadMfa=useCallback(async(parentSignal?:AbortSignal)=>{
    setMfaReadState("loading");const result=await runMfaRead(signal=>apiFetch<unknown>("/api/settings/mfa",{signal}),parentSignal);
    if(!result.current)return;
    const parsed="value" in result?mfaReadSchema.safeParse(result.value):null;
    if(!parsed?.success){setMfaReadState("error");return;}
    setFactors(parsed.data.factors);setRecoveryCodesRemaining(parsed.data.recoveryCodesRemaining);setMfaReadState("ready");
  },[runMfaRead]);
  useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>void loadMfa(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[loadMfa]);

  const enroll = async () => {
    setBusy(true); setMfaError(""); setMfaSuccess("");
    try {
      const result = await apiFetch<{ factor?: { id?: string; totp?: { qr_code?: string; secret?: string } }; challenge?: { id?: string } }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enroll" }) });
      if (!result.factor?.id || !result.challenge?.id) throw new Error();
      setEnrollment({ factorId: result.factor.id, challengeId: result.challenge.id, qrCode: result.factor.totp?.qr_code ?? "", secret: result.factor.totp?.secret });
    } catch {
      setMfaError(t("settings.mfaFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cancelEnrollment = async () => {
    if (!enrollment) return;
    setBusy(true); setMfaError(""); setMfaSuccess("");
    try {
      await apiFetch("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unenroll", factorId: enrollment.factorId }) });
      setEnrollment(undefined);
      setMfaSuccess(t("settings.mfaSetupCancelled"));
      void loadMfa();
    } catch {
      setMfaError(t("settings.mfaCancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollment) return;
    const code = String(new FormData(event.currentTarget).get("code"));
    setBusy(true); setMfaError(""); setMfaSuccess("");
    try {
      const result = await apiFetch<{ recoveryCodes?: string[] }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", factorId: enrollment.factorId, challengeId: enrollment.challengeId, code }) });
      setEnrollment(undefined);
      setRecoveryCodes(result.recoveryCodes ?? []);
      setRecoveryCopied(false);
      setRecoveryCodesRemaining(result.recoveryCodes?.length ?? 0);
      setMfaSuccess(t("settings.mfaEnabled"));
      void loadMfa();
    } catch {
      setMfaError(t("settings.mfaCodeInvalid"));
    } finally {
      setBusy(false);
    }
  };

  const rotateRecoveryCodes = async () => {
    setBusy(true); setMfaError(""); setMfaSuccess("");
    try {
      const result = await apiFetch<{ recoveryCodes?: string[] }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotateRecovery" }) });
      setRecoveryCodes(result.recoveryCodes ?? []);
      setRecoveryCopied(false);
      setRecoveryCodesRemaining(result.recoveryCodes?.length ?? 0);
      setMfaSuccess(t("settings.recoveryRotated"));
      setRotateConfirm(false);
    } catch {
      setMfaError(t("settings.recoveryRotateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const recoveryText = recoveryCodes.join("\n");
  const copyRecoveryCodes = async () => {
    try { await navigator.clipboard.writeText(recoveryText); setMfaError(""); setRecoveryCopied(true); setMfaSuccess(t("settings.recoveryCopied")); }
    catch { setRecoveryCopied(false); setMfaError(t("settings.recoveryCopyFailed")); }
  };
  const downloadRecoveryCodes = () => {
    const url = URL.createObjectURL(new Blob([`${t("settings.recoveryDownloadHeading")}\n\n${recoveryText}\n`], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "weiai-crm-recovery-codes.txt"; anchor.click(); URL.revokeObjectURL(url);
  };

  const disableMfa = async (factorId: string) => {
    setBusy(true); setMfaError(""); setMfaSuccess("");
    try {
      await apiFetch("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unenroll", factorId }) });
      setMfaSuccess(t("settings.mfaDisabled"));
      void loadMfa();
    } catch {
      setMfaError(t("settings.mfaDisableFailed"));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(""); setPasswordSuccess("");
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const newPassword = String(data.get("newPassword") ?? "");
    if (!passwordValueSchema.safeParse(newPassword).success) {
      setPasswordError(t("settings.passwordRule"));
      return;
    }
    if (newPassword !== data.get("confirmPassword")) {
      setPasswordError(t("settings.passwordMismatch"));
      return;
    }
    if(passwordChangeInFlight.current)return;
    passwordChangeInFlight.current=true;
    let navigationStarted=false;
    setBusy(true);
    try {
      const result=await apiFetch<{reauthenticate?:boolean;sessionsRevoked?:boolean;trustedDevicesRevoked?:boolean}>("/api/settings/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword }) });
      if(result.reauthenticate){
        const complete=result.sessionsRevoked&&result.trustedDevicesRevoked;
        navigationStarted=true;
        router.replace(`/login?security=${complete?"PASSWORD_CHANGED":"PASSWORD_CHANGED_REVIEW_SESSIONS"}`);
        router.refresh();
        return;
      }
      setPasswordSuccess(t("settings.passwordSaved"));
      formElement.reset();
    } catch (cause) {
      const code=cause instanceof ApiClientError?cause.code:"PASSWORD_UPDATE_FAILED";
      const errorKeys:Record<string,string>={CURRENT_PASSWORD_INCORRECT:"settings.currentPasswordIncorrect",AUTH_RATE_LIMITED:"settings.passwordRateLimited",AUTH_UNAVAILABLE:"settings.passwordServiceUnavailable",DATABASE_UNAVAILABLE:"settings.passwordServiceUnavailable",UPSTREAM_TIMEOUT:"settings.passwordServiceUnavailable",SAME_PASSWORD:"settings.passwordSame",WEAK_PASSWORD:"settings.passwordRule",INVALID_PASSWORD:"settings.passwordRule",REAUTHENTICATION_NEEDED:"settings.passwordReauthentication"};
      setPasswordError(t(errorKeys[code]??"settings.passwordFailed"));
    } finally {
      if(!navigationStarted){
        passwordChangeInFlight.current=false;
        setBusy(false);
      }
    }
  };

  const verifiedFactor = factors.find((factor) => factor.status === "verified");
  const administrator = user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  return <div>
    <SettingsHeader eyebrow="SECURITY" title={t("settings.security")} description={t("settings.securityHelp")} />
    <section className="mfa-card">
      <span><ShieldCheck size={25} /></span>
      <div><b>{mfaReadState!=="ready"?t("personalSettings.mfaUnknown"):verifiedFactor ? t("settings.mfaEnabled") : t("settings.mfaReady")}</b><p>{t("settings.mfaReadyHelp")}</p></div>
      <StatusBadge tone={mfaReadState!=="ready"?"gray":verifiedFactor ? "green" : administrator ? "amber" : "gray"}>{t(mfaReadState!=="ready"?"personalSettings.mfaUnknown":verifiedFactor ? "common.enabled" : administrator ? "settings.setupRequired" : "settings.optional")}</StatusBadge>
      {mfaReadState==="ready" && !verifiedFactor && !enrollment && <button className="secondary-button" type="button" disabled={busy} onClick={enroll}>{t("settings.manageMfa")}</button>}
      {mfaReadState==="ready" && verifiedFactor && !administrator && <button className="danger-button" type="button" disabled={busy} onClick={() => void disableMfa(verifiedFactor.id)}>{t("settings.disableMfa")}</button>}
    </section>
    {mfaReadState==="loading"&&<p role="status">{t("common.loading")}</p>}{mfaReadState==="error"&&<InlineMessage type="error">{t("settings.mfaFailed")}</InlineMessage>}<button className="secondary-button" type="button" disabled={busy||mfaReadState==="loading"} onClick={()=>void loadMfa()}>{t("personalSettings.mfaRetry")}</button>
    <MfaAuthenticatorGuide />
    {mfaError && <InlineMessage type="error">{mfaError}</InlineMessage>}
    {mfaSuccess && <InlineMessage type="success">{mfaSuccess}</InlineMessage>}
    {enrollment && <form className="settings-subform mfa-setup-panel" onSubmit={verify}>
      <h3>{t("settings.verifyMfa")}</h3>
      <div className="mfa-enrollment">{enrollment.qrCode ? <img className="mfa-qr" src={enrollment.qrCode} alt={t("settings.mfaQrAlt")} /> : <InlineMessage type="error">{t("settings.mfaQrMissing")}</InlineMessage>}{enrollment.secret && <small>{t("auth.mfa.manualSecret")} <code>{enrollment.secret}</code></small>}</div>
      <label className="field mfa-code-field"><span>{t("settings.mfaCode")}</span><input className="mfa-code-input" name="code" inputMode="numeric" pattern="[0-9]{6}" placeholder="000000" maxLength={6} autoComplete="one-time-code" required /></label>
      <div className="settings-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void cancelEnrollment()}>{t("common.cancel")}</button><button className="primary-button" disabled={busy}>{t("settings.verifyMfa")}</button></div>
    </form>}
    {verifiedFactor && <section className="recovery-section">
      <div className="recovery-section__heading"><div><h3>{t("settings.recoveryCodes")}</h3><p>{mfaReadState!=="ready"||recoveryCodesRemaining===null?t("personalSettings.recoveryUnknown"):t("settings.recoveryStatus", { count: recoveryCodesRemaining })}</p></div><button className="secondary-button" type="button" disabled={busy||mfaReadState!=="ready"} onClick={() => setRotateConfirm(true)}><RefreshCcw size={16}/>{t("settings.regenerateRecovery")}</button></div>
      {recoveryCodes.length > 0 && <>
        <InlineMessage type="warning">{t("settings.recoveryShownOnce")}</InlineMessage>
        <div className="recovery-code-grid">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div>
        <div className="recovery-code-actions">
          <button className="secondary-button" type="button" onClick={() => void copyRecoveryCodes()}>{recoveryCopied ? <Check size={16}/> : <Copy size={16}/>}<span aria-live="polite">{t(recoveryCopied ? "settings.recoveryCopied" : "settings.copyRecovery")}</span></button>
          <button className="secondary-button" type="button" onClick={downloadRecoveryCodes}><Download size={16}/>{t("settings.downloadRecovery")}</button>
        </div>
      </>}
    </section>}
    <form onSubmit={changePassword} className="settings-subform">
      <h3>{t("settings.changePassword")}</h3>
      <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" name="currentPassword" autoComplete="current-password" required /></label>
      <div className="form-grid two-column"><label className="field"><span>{t("settings.newPassword")}</span><input type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label className="field"><span>{t("settings.confirmPassword")}</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required /></label></div>
      <small className="field-help auth-password-rule">{t("settings.passwordRule")}</small>
      {passwordError && <InlineMessage type="error">{passwordError}</InlineMessage>}
      {passwordSuccess && <InlineMessage type="success">{passwordSuccess}</InlineMessage>}
      <div className="settings-actions"><span>{t("settings.securitySubmitHelp")}</span><button className="primary-button" type="submit" disabled={busy}><KeyRound size={16} />{t("settings.updatePassword")}</button></div>
    </form>
    {rotateConfirm && <ConfirmDialog title={t("settings.rotateRecoveryTitle")} description={t("settings.rotateRecoveryConfirm")} confirmLabel={t("settings.regenerateRecovery")} pending={busy} onClose={() => setRotateConfirm(false)} onConfirm={() => void rotateRecoveryCodes()}/>}
  </div>;
}

function SaveRow({ saving }: { saving: boolean }) { const { t } = useI18n(); return <div className="settings-actions"><span>{t("settings.requiredHelp")}</span><button className="primary-button" type="submit" disabled={saving}><Save size={16} />{saving ? t("settings.saving") : t("settings.saveChanges")}</button></div>; }
