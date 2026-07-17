"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MailPlus, MoreHorizontal, ShieldCheck, UserRoundPlus, X } from "lucide-react";
import type { StaffUserRecord } from "@/lib/admin-users-repository";
import type { AppRole } from "@/lib/roles";
import { roleMessageKey } from "@/lib/roles";
import { useAppUser } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchField, StatusBadge, Toast } from "./ui";

const assignableRoles: Exclude<AppRole, "SUPER_ADMIN">[] = ["ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"];

export function StaffUsersPage({ initialItems, initialTotal }: { initialItems: StaffUserRecord[]; initialTotal: number }) {
  const { locale, t } = useI18n();
  const currentUser = useAppUser();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    if (page === 1 && query === "" && reloadKey === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const response = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}&query=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json() as { items?: StaffUserRecord[]; total?: number };
        if (!response.ok || !result.items) throw new Error();
        setItems(result.items); setTotal(result.total ?? 0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(t("admin.users.loadFailed"));
      } finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, query, reloadKey, t]);

  const updateStatus = async (item: StaffUserRecord) => {
    const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const response = await fetch(`/api/admin/users/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setLoadError(t("admin.users.updateFailed")); return; }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry));
    setToast(t(status === "ACTIVE" ? "admin.users.activated" : "admin.users.suspended", { name: `${item.displayNameZh} / ${item.displayNameEn}` }));
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="page-stack">
    <section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.crmUsers")}</p><h1>{t("admin.users.title")}</h1><p>{t("admin.users.description")}</p></div><button className="primary-button" type="button" onClick={() => setInviteOpen(true)}><UserRoundPlus size={17}/>{t("admin.inviteUser")}</button></section>
    <section className="quick-summary"><span><b>{total}</b><small>{t("admin.registeredUsers")}</small></span><span><b>{items.filter((item) => item.status === "ACTIVE").length}</b><small>{t("admin.users.activeOnPage")}</small></span><span><b>{items.filter((item) => item.mfaEnabled).length}</b><small>{t("admin.users.mfaOnPage")}</small></span><span><b>{items.filter((item) => item.role === "SUPER_ADMIN" || item.role === "ADMIN").length}</b><small>{t("admin.users.adminsOnPage")}</small></span></section>
    <section className="surface staff-directory"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("admin.users.search")} />{loading && <span role="status">{t("admin.users.loading")}</span>}</div>
      {loadError && <InlineMessage type="error">{loadError}</InlineMessage>}
      <div className="staff-user-head"><span>{t("admin.users.identity")}</span><span>{t("admin.users.account")}</span><span>{t("settings.role")}</span><span>{t("common.mfa")}</span><span>{t("admin.lastLogin")}</span><span>{t("common.actions")}</span></div>
      <div className="staff-user-list">{items.map((item) => { const protectedAccount = item.role === "SUPER_ADMIN" || (currentUser.role !== "SUPER_ADMIN" && item.role === "ADMIN"); return <article className="staff-user-row" key={item.id}><div><span className="record-avatar user">{item.displayNameEn.split(/\s+/).map((part) => part[0]).join("").slice(0,2)}</span><span><b>{item.displayNameZh} / {item.displayNameEn}</b><small>{item.email}</small></span></div><span><b>@{item.username}</b><small>{item.id.slice(0,8)}</small></span><StatusBadge tone={item.role.includes("ADMIN") ? "purple" : item.role === "SALES_SUPPORT" ? "green" : "blue"}>{t(roleMessageKey[item.role])}</StatusBadge><StatusBadge tone={item.mfaEnabled ? "green" : "amber"}>{t(item.mfaEnabled ? "common.enabled" : "common.pending")}</StatusBadge><span><b>{item.lastSignInAt ? new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastSignInAt)) : t("admin.users.neverSignedIn")}</b><small>{t(item.status === "ACTIVE" ? "common.active" : "common.inactive")}</small></span><button className="icon-button" type="button" disabled={protectedAccount || item.id === currentUser.id} aria-label={t(item.status === "ACTIVE" ? "admin.users.suspendAction" : "admin.users.activateAction", { name: item.displayNameEn })} title={protectedAccount ? t("admin.superAdminProtected") : undefined} onClick={() => updateStatus(item)}><MoreHorizontal size={18}/></button></article>; })}</div>
      {!items.length && !loading && <div className="empty-state"><span>{t("admin.users.empty")}</span></div>}
      <Pagination page={Math.min(page,pages)} totalPages={pages} total={total} pageSize={pageSize} onPage={setPage}/>
    </section>
    <CreateStaffDialog open={inviteOpen} canCreateAdmin={currentUser.role === "SUPER_ADMIN"} close={() => setInviteOpen(false)} onCreated={() => { setInviteOpen(false); setPage(1); setQuery(""); setReloadKey((value) => value + 1); setToast(t("admin.users.created")); }} />
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function CreateStaffDialog({ open, canCreateAdmin, close, onCreated }: { open: boolean; canCreateAdmin: boolean; close: () => void; onCreated: () => void }) {
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(""); setFieldError({});
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { code?: string; field?: string };
      if (!response.ok) {
        const errorKeys: Record<string,string> = { INVALID_INPUT:"admin.users.error.INVALID_INPUT", USERNAME_TAKEN:"admin.users.error.USERNAME_TAKEN", ROLE_ASSIGNMENT_FORBIDDEN:"admin.users.error.ROLE_ASSIGNMENT_FORBIDDEN", ADMIN_SERVICE_NOT_CONFIGURED:"admin.users.error.ADMIN_SERVICE_NOT_CONFIGURED", ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED:"admin.users.error.ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED", ACCOUNT_EMAIL_DELIVERY_FAILED:"admin.users.error.ACCOUNT_EMAIL_DELIVERY_FAILED", email_exists:"admin.users.error.EMAIL_TAKEN" };
        const message = t(errorKeys[result.code ?? ""] ?? "admin.users.error.UNKNOWN");
        if (result.field) setFieldError({ [result.field]: message }); else setError(message);
        return;
      }
      event.currentTarget.reset(); onCreated();
    } catch { setError(t("admin.users.error.UNKNOWN")); }
    finally { setPending(false); }
  };

  return <dialog className="staff-dialog" ref={dialogRef} onClose={close} aria-labelledby="create-staff-title">
    <form method="dialog" className="dialog-close"><button className="icon-button" aria-label={t("common.close")}><X size={18}/></button></form>
    <form className="staff-invite-form" onSubmit={submit} noValidate>
      <div className="auth-form-heading"><p className="eyebrow">{t("admin.users.createEyebrow")}</p><h2 id="create-staff-title">{t("admin.users.createTitle")}</h2><p>{t("admin.users.createHelp")}</p></div>
      <div className="form-grid two-column"><Field name="displayNameZh" label={t("settings.nameZh")} error={fieldError.displayNameZh}/><Field name="displayNameEn" label={t("settings.nameEn")} error={fieldError.displayNameEn}/></div>
      <Field name="username" label={t("admin.users.username")} help={t("admin.users.usernameHelp")} error={fieldError.username}/>
      <Field name="email" label={t("common.email")} type="email" error={fieldError.email}/>
      <div className="form-grid two-column"><label className="field"><span>{t("settings.role")}</span><select name="role" defaultValue="SALES_SPECIALIST">{roles.map((role) => <option value={role} key={role}>{t(roleMessageKey[role])}</option>)}</select>{fieldError.role && <small className="field-error">{fieldError.role}</small>}</label><Field name="team" label={t("admin.users.team")} error={fieldError.team}/></div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      <InlineMessage type="warning"><ShieldCheck size={16}/>{t("admin.users.createBoundary")}</InlineMessage>
      <div className="drawer-actions"><button className="secondary-button" type="button" onClick={close}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending}><MailPlus size={16}/>{t(pending ? "admin.users.creating" : "admin.users.createAccount")}</button></div>
    </form>
  </dialog>;
}

function Field({ name, label, type = "text", help, error }: { name: string; label: string; type?: string; help?: string; error?: string }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} required aria-invalid={Boolean(error)}/>{help && <small className="field-help">{help}</small>}{error && <small className="field-error">{error}</small>}</label>;
}
