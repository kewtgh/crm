"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, MailPlus, MoreHorizontal, RotateCcw, ShieldCheck, UserRoundPlus, X } from "lucide-react";
import type { StaffInvitationDeliveryStatus, StaffUserRecord } from "@/lib/admin-users-repository";
import type { AppRole } from "@/lib/roles";
import { roleMessageKey } from "@/lib/roles";
import { useAppUser } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchField, StatusBadge, Toast } from "./ui";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";

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
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const resendKeys = useRef(new Map<string,string>());

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const result = await apiFetch<{ items?: StaffUserRecord[]; total?: number }>(`/api/admin/users?page=${page}&pageSize=${pageSize}&query=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!result.items) throw new Error();
        setItems(result.items); setTotal(result.total ?? 0);
      } catch (error) {
        if (!(error instanceof ApiClientError && error.code === "REQUEST_ABORTED")) setLoadError(t("admin.users.loadFailed"));
      } finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, pageSize, query, reloadKey, t]);

  const updateStatus = async (item: StaffUserRecord) => {
    const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await apiFetch(`/api/admin/users/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    } catch { setLoadError(t("admin.users.updateFailed")); return; }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry));
    setToast(t(status === "ACTIVE" ? "admin.users.activated" : "admin.users.suspended", { name: `${item.displayNameZh} / ${item.displayNameEn}` }));
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
    <section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.crmUsers")}</p><h1>{t("admin.users.title")}</h1><p>{t("admin.users.description")}</p></div><button className="primary-button" type="button" onClick={() => setInviteOpen(true)}><UserRoundPlus size={17}/>{t("admin.inviteUser")}</button></section>
    <section className="quick-summary"><span><b>{total}</b><small>{t("admin.registeredUsers")}</small></span><span><b>{items.filter((item) => item.status === "ACTIVE" && item.onboardingStatus === "ACTIVE").length}</b><small>{t("admin.users.activeOnPage")}</small></span><span><b>{items.filter((item) => item.mfaEnabled).length}</b><small>{t("admin.users.mfaOnPage")}</small></span><span><b>{items.filter((item) => item.role === "SUPER_ADMIN" || item.role === "ADMIN").length}</b><small>{t("admin.users.adminsOnPage")}</small></span></section>
    <section className="surface staff-directory"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("admin.users.search")} />{loading && <span role="status">{t("admin.users.loading")}</span>}</div>
      {loadError && <InlineMessage type="error">{loadError}</InlineMessage>}
      <div className="staff-user-head"><span>{t("admin.users.identity")}</span><span>{t("admin.users.account")}</span><span>{t("settings.role")}</span><span>{t("common.mfa")}</span><span>{t("admin.lastLogin")}</span><span>{t("common.actions")}</span></div>
      <div className="staff-user-list">{items.map((item) => { const protectedAccount = item.role === "SUPER_ADMIN" || (currentUser.role !== "SUPER_ADMIN" && item.role === "ADMIN"); const awaitingConfirmation = item.status === "ACTIVE" && item.onboardingStatus === "AWAITING_EMAIL_CONFIRMATION"; return <article className="staff-user-row" key={item.id}><div><span className="record-avatar user">{item.displayNameEn.split(/\s+/).map((part) => part[0]).join("").slice(0,2)}</span><span><b>{item.displayNameZh} / {item.displayNameEn}</b><small>{item.email}</small></span></div><span><b>@{item.username}</b><small>{item.id.slice(0,8)}</small></span><StatusBadge tone={item.role.includes("ADMIN") ? "purple" : item.role === "SALES_SUPPORT" ? "green" : "blue"}>{t(roleMessageKey[item.role])}</StatusBadge><StatusBadge tone={item.mfaEnabled ? "green" : "amber"}>{t(item.mfaEnabled ? "common.enabled" : "common.pending")}</StatusBadge><span><b>{awaitingConfirmation ? t("admin.users.awaitingEmailConfirmation") : item.lastSignInAt ? formatDate(item.lastSignInAt, { includeTime: true }) : t("admin.users.neverSignedIn")}</b><small>{t(item.status !== "ACTIVE" ? "common.inactive" : awaitingConfirmation ? `admin.users.invitationStatus.${(item.invitationDeliveryStatus ?? "UNCERTAIN").toLowerCase()}` : "common.active")}</small></span><details className="staff-action-menu"><summary className="icon-button" aria-label={t("common.actions")}><MoreHorizontal size={18}/></summary><div role="menu"><button type="button" role="menuitem" disabled={protectedAccount || item.id === currentUser.id} onClick={() => void updateStatus(item)}>{t(item.status === "ACTIVE" ? "admin.users.suspendAction" : "admin.users.activateAction", { name: item.displayNameEn })}</button>{awaitingConfirmation && <button type="button" role="menuitem" onClick={() => void resendInvitation(item)}><RotateCcw size={15}/>{t("admin.users.resendInvitation")}</button>}</div></details></article>; })}</div>
      {!items.length && !loading && <div className="empty-state"><span>{t("admin.users.empty")}</span></div>}
      <Pagination page={Math.min(page,pages)} totalPages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(value)=>{setPageSize(value);setPage(1);}}/>
    </section>
    <CreateStaffDialog open={inviteOpen} canCreateAdmin={currentUser.role === "SUPER_ADMIN"} close={() => setInviteOpen(false)} onCreated={(item, deliveryStatus) => { setInviteOpen(false); setPage(1); setQuery(""); setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]); setTotal((current) => current + (items.some((entry) => entry.id === item.id) ? 0 : 1)); setReloadKey((value) => value + 1); setToast(t(staffCreationMessageKey(deliveryStatus))); }} />
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function CreateStaffDialog({ open, canCreateAdmin, close, onCreated }: { open: boolean; canCreateAdmin: boolean; close: () => void; onCreated: (item: StaffUserRecord, deliveryStatus: StaffInvitationDeliveryStatus) => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string,string>>({});
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
      <div className="form-grid two-column"><label className="field"><span>{t("settings.role")}</span><select name="role" defaultValue="SALES_SPECIALIST">{roles.map((role) => <option value={role} key={role}>{t(roleMessageKey[role])}</option>)}</select>{fieldError.role && <small className="field-error">{fieldError.role}</small>}</label><Field name="team" label={t("admin.users.team")} error={fieldError.team}/></div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      <InlineMessage type="warning"><ShieldCheck size={16}/>{t("admin.users.createBoundary")}</InlineMessage>
      <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={closeDialog}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending}><MailPlus size={16}/>{t(pending ? "admin.users.creating" : "admin.users.createAccount")}</button></div>
    </form>
  </dialog>;
}

function Field({ name, label, type = "text", help, error }: { name: string; label: string; type?: string; help?: string; error?: string }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} required aria-invalid={Boolean(error)}/>{help && <small className="field-help">{help}</small>}{error && <small className="field-error">{error}</small>}</label>;
}
