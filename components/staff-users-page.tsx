"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, MailPlus, MoreHorizontal, Plus, RotateCcw, ShieldCheck, UserRoundPlus, Users, X } from "lucide-react";
import type { StaffDirectoryRole, StaffDirectoryStatus, StaffInvitationDeliveryStatus, StaffUserRecord } from "@/lib/admin-users-repository";
import type { AppRole } from "@/lib/roles";
import { APP_ROLES, roleMessageKey } from "@/lib/roles";
import { useAppUser } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer, ConfirmDialog, InlineMessage, Pagination, SearchField, StatusBadge, Toast } from "./ui";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import type { TeamLeadCandidate, TeamRecord } from "@/lib/team-repository";

const assignableRoles: Exclude<AppRole, "SUPER_ADMIN">[] = ["ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"];
const createErrorKeys: Record<string,string> = { INVALID_INPUT:"admin.users.error.INVALID_INPUT", USERNAME_TAKEN:"admin.users.error.USERNAME_TAKEN", STAFF_IDENTITY_TAKEN:"admin.users.error.IDENTITY_TAKEN", RECORD_CONFLICT:"admin.users.error.IDENTITY_TAKEN", ROLE_ASSIGNMENT_FORBIDDEN:"admin.users.error.ROLE_ASSIGNMENT_FORBIDDEN", ADMIN_SERVICE_NOT_CONFIGURED:"admin.users.error.ADMIN_SERVICE_NOT_CONFIGURED", DATABASE_UNAVAILABLE:"admin.users.error.SERVICE_UNAVAILABLE", UPSTREAM_TIMEOUT:"admin.users.error.SERVICE_UNAVAILABLE", WORKSPACE_NOT_CONFIGURED:"admin.users.error.WORKSPACE_NOT_CONFIGURED", ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED:"admin.users.error.ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED", STAFF_USERS_FAILED:"admin.users.error.SERVICE_UNAVAILABLE", STAFF_USER_CREATE_FAILED:"admin.users.error.SERVICE_UNAVAILABLE" };

export function staffCreationMessageKey(status: StaffInvitationDeliveryStatus) {
  return status === "SENT" ? "admin.users.created" : "admin.users.createdDeliveryUnconfirmed";
}

export function staffAccountErrorMessageKey(code: string) {
  return createErrorKeys[code] ?? "admin.users.error.UNKNOWN";
}

type CreateStaffResult = { item: StaffUserRecord; emailDeliveryStatus: StaffInvitationDeliveryStatus };

export async function submitStaffAccount({
  form,
  payload,
  request,
  onCreated,
}: {
  form: Pick<HTMLFormElement, "reset">;
  payload: Record<string, FormDataEntryValue>;
  request: (payload: Record<string, FormDataEntryValue>) => Promise<CreateStaffResult>;
  onCreated: (item: StaffUserRecord, deliveryStatus: StaffInvitationDeliveryStatus) => void;
}) {
  let result: CreateStaffResult;
  try {
    result = await request(payload);
  } catch (cause) {
    return { ok: false as const, cause };
  }
  form.reset();
  onCreated(result.item, result.emailDeliveryStatus);
  return { ok: true as const, result };
}

export function StaffUsersPage({ initialItems, initialTotal }: { initialItems: StaffUserRecord[]; initialTotal: number }) {
  const { t } = useI18n();
  const { formatDate } = useUserPreferences();
  const currentUser = useAppUser();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffDirectoryStatus>("ALL");
  const [roleFilter, setRoleFilter] = useState<StaffDirectoryRole>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamOpen,setTeamOpen]=useState(false);
  const [teams,setTeams]=useState<TeamRecord[]>([]);
  const [leadCandidates,setLeadCandidates]=useState<TeamLeadCandidate[]>([]);
  const [toast, setToast] = useState("");
  const [actionMenuUserId, setActionMenuUserId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<StaffUserRecord | null>(null);
  const [teamTarget,setTeamTarget]=useState<StaffUserRecord|null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const resendKeys = useRef(new Map<string,string>());

  const loadTeams=useCallback(async(signal?:AbortSignal)=>{
    try{
      const result=await apiFetch<{items:TeamRecord[];leadCandidates:TeamLeadCandidate[]}>("/api/admin/teams",{signal});
      if(!signal?.aborted){setTeams(result.items);setLeadCandidates(result.leadCandidates);}
    }catch(error){if(!(error instanceof ApiClientError&&error.code==="REQUEST_ABORTED"))setLoadError(t("admin.teams.loadFailed"));}
  },[t]);
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>{void loadTeams(controller.signal);},0);return()=>{window.clearTimeout(timer);controller.abort();};},[loadTeams]);

  useEffect(() => {
    if (!actionMenuUserId) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && document.querySelector(`[data-staff-action-menu="${actionMenuUserId}"]`)?.contains(target)) return;
      setActionMenuUserId(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => { document.removeEventListener("mousedown", closeMenu); };
  }, [actionMenuUserId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const params = new URLSearchParams({
          page:String(page),pageSize:String(pageSize),query,status:statusFilter,role:roleFilter,
        });
        const result = await apiFetch<{ items?: StaffUserRecord[]; total?: number }>(`/api/admin/users?${params}`, { signal: controller.signal });
        if (!result.items) throw new Error();
        setItems(result.items); setTotal(result.total ?? 0);
      } catch (error) {
        if (!(error instanceof ApiClientError && error.code === "REQUEST_ABORTED")) setLoadError(t("admin.users.loadFailed"));
      } finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, pageSize, query, reloadKey, roleFilter, statusFilter, t]);

  const updateStatus = async (item: StaffUserRecord) => {
    const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setStatusPending(true);
    try {
      await apiFetch(`/api/admin/users/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    } catch { setLoadError(t("admin.users.updateFailed")); setStatusPending(false); return; }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry));
    setReloadKey((value) => value + 1);
    setToast(t(status === "ACTIVE" ? "admin.users.activated" : "admin.users.suspended", { name: `${item.displayNameZh} / ${item.displayNameEn}` }));
    setStatusPending(false);
    setStatusTarget(null);
  };

  const resendInvitation = async (item: StaffUserRecord) => {
    const idempotencyKey = resendKeys.current.get(item.id) ?? crypto.randomUUID();
    resendKeys.current.set(item.id, idempotencyKey);
    try {
      const result = await apiFetch<{ item: StaffUserRecord; invitationDeliveryStatus: StaffUserRecord["invitationDeliveryStatus"] }>(
        `/api/admin/users/${item.id}/resend-invitation`,
        { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ idempotencyKey }) },
      );
      resendKeys.current.delete(item.id);
      setItems((current) => current.map((entry) => entry.id === item.id ? result.item : entry));
      setReloadKey((value) => value + 1);
      setToast(t("admin.users.invitationQueued"));
    } catch (cause) {
      const code = cause instanceof ApiClientError ? cause.code : "";
      setLoadError(t(code === "STAFF_INVITATION_NOT_PENDING"
        ? "admin.users.error.INVITATION_NOT_PENDING"
        : "admin.users.error.INVITATION_RESEND_FAILED"));
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="page-stack">
    <section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.crmUsers")}</p><h1>{t("admin.users.title")}</h1><p>{t("admin.users.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button" onClick={()=>setTeamOpen(true)}><Users size={17}/>{t("admin.teams.new")}</button><button className="primary-button" type="button" onClick={() => setInviteOpen(true)}><UserRoundPlus size={17}/>{t("admin.inviteUser")}</button></div></section>
    <section className="quick-summary"><span><b>{total}</b><small>{t("admin.registeredUsers")}</small></span><span><b>{items.filter((item) => item.status === "ACTIVE" && item.onboardingStatus === "ACTIVE").length}</b><small>{t("admin.users.activeOnPage")}</small></span><span><b>{items.filter((item) => item.mfaEnabled).length}</b><small>{t("admin.users.mfaOnPage")}</small></span><span><b>{items.filter((item) => item.role === "SUPER_ADMIN" || item.role === "ADMIN").length}</b><small>{t("admin.users.adminsOnPage")}</small></span></section>
    <section className="surface staff-directory"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("admin.users.search")} /><div className="filter-chips staff-directory-filters"><label className="compact-select"><span>{t("admin.users.statusFilter")}</span><select value={statusFilter} onChange={(event)=>{setStatusFilter(event.target.value as StaffDirectoryStatus);setPage(1);}}><option value="ALL">{t("common.all")}</option><option value="ACTIVE">{t("common.active")}</option><option value="PENDING">{t("admin.users.status.pending")}</option><option value="SUSPENDED">{t("common.inactive")}</option></select></label><label className="compact-select"><span>{t("admin.users.roleFilter")}</span><select value={roleFilter} onChange={(event)=>{setRoleFilter(event.target.value as StaffDirectoryRole);setPage(1);}}><option value="ALL">{t("common.all")}</option>{APP_ROLES.map((role)=><option value={role} key={role}>{t(roleMessageKey[role])}</option>)}</select></label></div>{loading && <span role="status">{t("admin.users.loading")}</span>}</div>
      {loadError && <InlineMessage type="error">{loadError}</InlineMessage>}
      <div className="staff-user-head"><span>{t("admin.users.identity")}</span><span>{t("admin.users.account")}</span><span>{t("settings.role")}</span><span>{t("common.mfa")}</span><span>{t("admin.lastLogin")}</span><span>{t("common.actions")}</span></div>
      <div className="staff-user-list">{items.map((item) => { const awaitingConfirmation = item.status === "ACTIVE" && item.onboardingStatus === "AWAITING_EMAIL_CONFIRMATION"; return <article className="staff-user-row" key={item.id}><div className="staff-user-identity"><span className="record-avatar user">{item.displayNameEn.split(/\s+/).map((part) => part[0]).join("").slice(0,2)}</span><span><b>{item.displayNameZh} / {item.displayNameEn}</b><small>{item.email}</small><small className="staff-team-summary">{item.teams.length?item.teams.map(team=>`${team.nameZh}${team.role==="LEAD"?` · ${t("admin.teams.leadBadge")}`:""}`).join("、"):t("admin.teams.unassigned")}</small></span></div><span className="staff-user-account" data-label={t("admin.users.account")}><b>@{item.username}</b><small>{item.id.slice(0,8)}</small></span><div className="staff-user-role" data-label={t("settings.role")}><StatusBadge tone={item.role.includes("ADMIN") ? "purple" : item.role === "SALES_SUPPORT" ? "green" : "blue"}>{t(roleMessageKey[item.role])}</StatusBadge></div><div className="staff-user-mfa" data-label={t("common.mfa")}><StatusBadge tone={item.mfaEnabled ? "green" : "amber"}>{t(item.mfaEnabled ? "common.enabled" : "common.pending")}</StatusBadge></div><span className="staff-user-last-sign-in" data-label={t("admin.lastLogin")}><b>{awaitingConfirmation ? t("admin.users.awaitingEmailConfirmation") : item.lastSignInAt ? formatDate(item.lastSignInAt, { includeTime: true }) : t("admin.users.neverSignedIn")}</b><small>{t(item.status !== "ACTIVE" ? "common.inactive" : awaitingConfirmation ? `admin.users.invitationStatus.${(item.invitationDeliveryStatus ?? "UNCERTAIN").toLowerCase()}` : "common.active")}</small></span><StaffActionMenu item={item} currentUser={currentUser} open={actionMenuUserId === item.id} setOpen={setActionMenuUserId} onStatus={()=>setStatusTarget(item)} onResend={()=>void resendInvitation(item)} onTeams={()=>setTeamTarget(item)}/></article>; })}</div>
      {!items.length && !loading && <div className="empty-state"><span>{t("admin.users.empty")}</span></div>}
      <Pagination page={Math.min(page,pages)} totalPages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(value)=>{setPageSize(value);setPage(1);}}/>
    </section>
    <CreateStaffDialog open={inviteOpen} teams={teams.filter(team=>team.active)} canCreateAdmin={currentUser.role === "SUPER_ADMIN"} close={() => setInviteOpen(false)} onCreated={(item, deliveryStatus) => { setInviteOpen(false); setPage(1); setQuery(""); setStatusFilter("ALL");setRoleFilter("ALL");setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]); setTotal((current) => current + (items.some((entry) => entry.id === item.id) ? 0 : 1)); setReloadKey((value) => value + 1); void loadTeams();setToast(t(staffCreationMessageKey(deliveryStatus))); }} />
    <TeamDialog open={teamOpen} teams={teams} leadCandidates={leadCandidates} close={()=>setTeamOpen(false)} onSaved={team=>{setTeams(current=>[...current.filter(item=>item.id!==team.id),team].sort((a,b)=>a.nameEn.localeCompare(b.nameEn)));setTeamOpen(false);setToast(t("admin.teams.saved"));}}/>
    {teamTarget&&<TeamMembershipDialog user={teamTarget} teams={teams.filter(team=>team.active)} close={()=>setTeamTarget(null)} onSaved={memberships=>{setItems(current=>current.map(item=>item.id===teamTarget.id?{...item,teams:memberships}:item));setTeamTarget(null);void loadTeams();setToast(t("admin.teams.assignmentsSaved"));}}/>}
    {statusTarget && <ConfirmDialog title={t(statusTarget.status === "ACTIVE" ? "admin.users.suspendConfirmTitle" : "admin.users.activateConfirmTitle", { name: statusTarget.displayNameEn })} description={t(statusTarget.status === "ACTIVE" ? "admin.users.suspendConfirmDescription" : "admin.users.activateConfirmDescription", { name: `${statusTarget.displayNameZh} / ${statusTarget.displayNameEn}` })} confirmLabel={t(statusTarget.status === "ACTIVE" ? "admin.users.suspendAction" : "admin.users.activateAction", { name: statusTarget.displayNameEn })} pending={statusPending} tone={statusTarget.status === "ACTIVE" ? "danger" : "primary"} onClose={() => { if (!statusPending) setStatusTarget(null); }} onConfirm={() => void updateStatus(statusTarget)} />}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function StaffActionMenu({item,currentUser,open,setOpen,onStatus,onResend,onTeams}:{item:StaffUserRecord;currentUser:ReturnType<typeof useAppUser>;open:boolean;setOpen:React.Dispatch<React.SetStateAction<string|null>>;onStatus:()=>void;onResend:()=>void;onTeams:()=>void}){
  const{t}=useI18n();
  const triggerRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const protectedAccount=item.role==="SUPER_ADMIN"||(currentUser.role!=="SUPER_ADMIN"&&item.role==="ADMIN");
  const awaitingConfirmation=item.status==="ACTIVE"&&item.onboardingStatus==="AWAITING_EMAIL_CONFIRMATION";
  useEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus());
    return()=>window.cancelAnimationFrame(frame);
  },[open]);
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key==="Escape"){
      event.preventDefault();triggerRef.current?.focus();setOpen(null);return;
    }
    if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    const options=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)")??[]);
    if(!options.length)return;
    event.preventDefault();
    const index=options.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==="Home"?0:event.key==="End"?options.length-1:event.key==="ArrowDown"?(index+1+options.length)%options.length:(index-1+options.length)%options.length;
    options[next]?.focus();
  };
  return <div className="staff-action-menu" data-staff-action-menu={item.id}><button ref={triggerRef} className="icon-button staff-action-trigger" type="button" aria-label={t("common.actions")} aria-haspopup="menu" aria-expanded={open} aria-controls={open?`staff-actions-${item.id}`:undefined} onClick={()=>setOpen((current)=>current===item.id?null:item.id)}><MoreHorizontal size={18}/></button>{open&&<div ref={menuRef} id={`staff-actions-${item.id}`} role="menu" onKeyDown={onKeyDown}>{item.role.startsWith("SALES_")&&<button type="button" role="menuitem" onClick={()=>{setOpen(null);onTeams();}}><Users size={15}/>{t("admin.teams.adjustMemberships")}</button>}<button type="button" role="menuitem" disabled={protectedAccount||item.id===currentUser.id} onClick={()=>{setOpen(null);onStatus();}}>{t(item.status==="ACTIVE"?"admin.users.suspendAction":"admin.users.activateAction",{name:item.displayNameEn})}</button>{awaitingConfirmation&&<button type="button" role="menuitem" onClick={()=>{setOpen(null);onResend();}}><RotateCcw size={15}/>{t("admin.users.resendInvitation")}</button>}</div>}</div>;
}

function CreateStaffDialog({ open, teams, canCreateAdmin, close, onCreated }: { open: boolean; teams:TeamRecord[]; canCreateAdmin: boolean; close: () => void; onCreated: (item: StaffUserRecord, deliveryStatus: StaffInvitationDeliveryStatus) => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string,string>>({});
  const [selectedRole,setSelectedRole]=useState<AppRole>("SALES_SPECIALIST");
  const roles = useMemo(() => assignableRoles.filter((role) => canCreateAdmin || role !== "ADMIN"), [canCreateAdmin]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  const closeDialog = () => {
    if (pending) return;
    setError("");
    setFieldError({});
    close();
  };

  const clearEditedFieldError = (event: React.FormEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    setError("");
    if (!target.name) return;
    setFieldError((current) => {
      if (!current[target.name]) return current;
      const next = { ...current };
      delete next[target.name];
      return next;
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(""); setFieldError({});
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const outcome = await submitStaffAccount({
      form:formElement,
      payload,
      request:(body) => apiFetch<CreateStaffResult>("/api/admin/users", {
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
      }),
      onCreated,
    });
    if (!outcome.ok) {
      const cause = outcome.cause;
      const code = cause instanceof ApiClientError ? cause.code : "";
      const field = cause instanceof ApiClientError && typeof cause.details?.field === "string" ? cause.details.field : "";
      const message = t(staffAccountErrorMessageKey(code));
      if (field) setFieldError({ [field]: message }); else setError(message);
    }
    setPending(false);
  };

  return <dialog className="staff-dialog" ref={dialogRef} onClose={closeDialog} onCancel={(event)=>{if(pending)event.preventDefault();}} aria-labelledby="create-staff-title" aria-busy={pending||undefined}>
    <form method="dialog" className="dialog-close"><button className="icon-button" disabled={pending} aria-label={t("common.close")}><X size={18}/></button></form>
    <form className="staff-invite-form" onSubmit={submit} onChange={clearEditedFieldError} noValidate>
      <div className="auth-form-heading"><p className="eyebrow">{t("admin.users.createEyebrow")}</p><h2 id="create-staff-title">{t("admin.users.createTitle")}</h2><p>{t("admin.users.createHelp")}</p></div>
      <div className="credential-flow"><span><KeyRound size={20}/></span><div><b>{t("admin.users.passwordGenerated")}</b><p>{t("admin.users.passwordGeneratedHelp")}</p></div></div>
      <div className="form-grid two-column"><Field name="displayNameZh" label={t("settings.nameZh")} error={fieldError.displayNameZh}/><Field name="displayNameEn" label={t("settings.nameEn")} error={fieldError.displayNameEn}/></div>
      <Field name="username" label={t("admin.users.username")} help={t("admin.users.usernameHelp")} error={fieldError.username}/>
      <Field name="email" label={t("common.email")} type="email" error={fieldError.email}/>
      <div className="form-grid two-column"><label className="field"><span>{t("settings.role")}</span><select name="role" value={selectedRole} onChange={event=>setSelectedRole(event.target.value as AppRole)}>{roles.map((role) => <option value={role} key={role}>{t(roleMessageKey[role])}</option>)}</select>{fieldError.role && <small className="field-error">{fieldError.role}</small>}</label>{selectedRole.startsWith("SALES_")&&<label className="field"><span>{t("admin.users.team")}</span><select name="teamId" required defaultValue=""><option value="" disabled>{t("admin.teams.select")}</option>{teams.map(team=><option key={team.id} value={team.id}>{team.nameZh} / {team.nameEn}</option>)}</select>{fieldError.teamId&&<small className="field-error">{fieldError.teamId}</small>}</label>}</div>
      {selectedRole.startsWith("SALES_")&&!teams.length&&<InlineMessage type="warning">{t("admin.teams.createFirst")}</InlineMessage>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      <InlineMessage type="warning"><ShieldCheck size={16}/>{t("admin.users.createBoundary")}</InlineMessage>
      <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={closeDialog}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending||(selectedRole.startsWith("SALES_")&&!teams.length)}><MailPlus size={16}/>{t(pending ? "admin.users.creating" : "admin.users.createAccount")}</button></div>
    </form>
  </dialog>;
}

function TeamMembershipDialog({user,teams,close,onSaved}:{user:StaffUserRecord;teams:TeamRecord[];close:()=>void;onSaved:(teams:StaffUserRecord["teams"])=>void}){
  const{t}=useI18n();const[selected,setSelected]=useState(()=>user.teams.filter(team=>team.status==="ACTIVE").map(team=>team.id));const[pending,setPending]=useState(false);const[error,setError]=useState("");
  const save=async()=>{setPending(true);setError("");try{const result=await apiFetch<{memberships:Array<{teamId:string;code:string;nameZh:string;nameEn:string;role:"MEMBER"|"LEAD";status:string}>}>("/api/admin/team-memberships",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId:user.id,teamIds:selected})});onSaved(result.memberships.filter(item=>item.status==="ACTIVE").map(item=>({id:item.teamId,code:item.code,nameZh:item.nameZh,nameEn:item.nameEn,role:item.role,status:"ACTIVE" as const})));}catch{setError(t("admin.teams.assignmentsFailed"));}finally{setPending(false);}};
  return <AccessibleDrawer pending={pending} title={t("admin.teams.adjustFor",{name:`${user.displayNameZh} / ${user.displayNameEn}`})} description={t("admin.teams.multiMembershipHelp")} onClose={close}><div className="team-membership-options">{teams.map(team=>{const existing=user.teams.find(item=>item.id===team.id);return <label className="checkbox-row" key={team.id}><input type="checkbox" checked={selected.includes(team.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,team.id]:current.filter(id=>id!==team.id))}/><span><b>{team.nameZh} / {team.nameEn}</b><small>{team.code}{existing?.role==="LEAD"?` · ${t("admin.teams.leadBadge")}`:""}{existing?.status==="PENDING"?` · ${t("admin.teams.membership.pending")}`:""}</small></span></label>;})}</div>{!teams.length&&<p className="select-empty">{t("admin.teams.none")}</p>}{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={close}>{t("common.cancel")}</button><button className="primary-button" type="button" disabled={pending} onClick={()=>void save()}>{pending?t("common.saving"):t("common.save")}</button></div></AccessibleDrawer>;
}

function TeamDialog({open,teams,leadCandidates,close,onSaved}:{open:boolean;teams:TeamRecord[];leadCandidates:TeamLeadCandidate[];close:()=>void;onSaved:(team:TeamRecord)=>void}){
  const{t}=useI18n();const dialogRef=useRef<HTMLDialogElement>(null);const[pending,setPending]=useState(false);const[error,setError]=useState("");const[editingId,setEditingId]=useState("");
  const editing=teams.find(team=>team.id===editingId);
  useEffect(()=>{const dialog=dialogRef.current;if(open&&!dialog?.open)dialog?.showModal();if(!open&&dialog?.open)dialog.close();},[open]);
  const closeDialog=()=>{if(pending)return;setError("");setEditingId("");close();};
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);setPending(true);setError("");try{const result=await apiFetch<{item:TeamRecord}>("/api/admin/teams",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:editingId||undefined,code:form.get("code"),nameZh:form.get("nameZh"),nameEn:form.get("nameEn"),descriptionMarkdown:form.get("descriptionMarkdown"),leadUserIds:form.getAll("leadUserIds"),active:true})});onSaved(result.item);setEditingId("");}catch{setError(t("admin.teams.saveFailed"));}finally{setPending(false);}};
  return <dialog className="staff-dialog" ref={dialogRef} onClose={closeDialog} onCancel={event=>{if(pending)event.preventDefault();else closeDialog();}}>
    <form method="dialog" className="dialog-close"><button className="icon-button" disabled={pending} aria-label={t("common.close")}><X size={18}/></button></form>
    <form key={editingId||"new"} className="staff-invite-form" onSubmit={submit}><div className="auth-form-heading"><p className="eyebrow">{t("admin.teams.eyebrow")}</p><h2>{t(editing?"admin.teams.edit":"admin.teams.new")}</h2><p>{t("admin.teams.help")}</p></div>
      <label className="field"><span>{t("admin.teams.existing")}</span><select value={editingId} onChange={event=>setEditingId(event.target.value)}><option value="">{t("admin.teams.newOption")}</option>{teams.map(team=><option key={team.id} value={team.id}>{team.nameZh} / {team.nameEn}</option>)}</select><small>{teams.length?t("admin.teams.existingCount",{count:teams.length}):t("admin.teams.none")}</small></label>
      <div className="form-grid two-column"><Field name="nameZh" label={t("settings.nameZh")} defaultValue={editing?.nameZh}/><Field name="nameEn" label={t("settings.nameEn")} defaultValue={editing?.nameEn}/></div>
      <label className="field"><span>{t("admin.teams.code")}</span><input name="code" pattern="[A-Za-z0-9-]+" required defaultValue={editing?.code}/></label>
      <fieldset className="team-lead-options"><legend>{t("admin.teams.leads")}</legend><small>{t("admin.teams.multiLeadHelp")}</small>{leadCandidates.map(candidate=><label className="checkbox-row" key={candidate.memberId}><input name="leadUserIds" type="checkbox" value={candidate.userId} defaultChecked={editing?.leadUserIds.includes(candidate.userId)}/><span>{candidate.name} · {t(roleMessageKey[candidate.role as AppRole])}</span></label>)}</fieldset>
      <label className="field"><span>{t("admin.teams.description")}</span><textarea name="descriptionMarkdown" rows={4} data-markdown="true" defaultValue={editing?.descriptionMarkdown}/><small>{t("common.markdownSupported")}</small></label>
      {error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={closeDialog}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Plus size={16}/>{pending?t("common.saving"):t(editing?"common.save":"common.create")}</button></div>
    </form></dialog>;
}

function Field({ name, label, type = "text", help, error, defaultValue }: { name: string; label: string; type?: string; help?: string; error?: string; defaultValue?:string }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} required aria-invalid={Boolean(error)} defaultValue={defaultValue}/>{help && <small className="field-help">{help}</small>}{error && <small className="field-error">{error}</small>}</label>;
}
