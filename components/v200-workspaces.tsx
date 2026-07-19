"use client";

import { useCallback, useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, GraduationCap, History, Home, Plus, RefreshCw, Save, ShieldCheck, Sparkles, Target, Trash2, XCircle } from "lucide-react";
import { useCapability } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer, InlineMessage, Pagination, SearchableSelect, SearchField, StatusBadge, Toast } from "./ui";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type {
  HouseholdRecord,
  HouseholdDetail,
  LeadRecord,
  PageResult,
  PrivacyRequestRecord,
  ProgressionBatchRecord,
  ProgressionItemRecord,
  ProgressionRuleRecord,
  StudentDetail,
  StudentRecord,
  SuggestionRecord,
} from "@/lib/v200-repository";

const statusTone = (status: string) => status === "ACTIVE" || status === "APPLIED" || status === "ACCEPTED" || status === "FULFILLED" || status === "QUALIFIED"
  ? "green" : status === "REJECTED" || status === "FAILED" || status === "DISQUALIFIED" ? "red" : "amber";

export function StudentsWorkspace({ initial, initialDetail = null }: { initial: PageResult<StudentRecord>; initialDetail?: StudentDetail | null }) {
  const { locale, t } = useI18n();
  const canManage = useCapability("education.manage");
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [household, setHousehold] = useState(initialDetail?.householdId ?? "");
  const [people, setPeople] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [households, setHouseholds] = useState<Array<{ value: string; label: string; detail?: string }>>(initialDetail?.householdId?[{value:initialDetail.householdId,label:locale==="zh-CN"?initialDetail.householdZh:initialDetail.householdEn}]:[]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const [detail, setDetail] = useState<StudentDetail | null>(initialDetail);
  const [guardianContact,setGuardianContact]=useState("");
  const [school, setSchool] = useState("");
  const [schools, setSchools] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const load = async (page = data.page, pageSize = data.pageSize, q = query) => {
    try {
      setData(await apiFetch<PageResult<StudentRecord>>(`/api/education?resource=students&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`));
      setError("");
    } catch (caught) { setError(presentApiError(caught, t, "education.loadFailed").message); }
  };
  const searchPeople = useCallback(async (q: string) => {
    if (q.trim().length < 2) return;
    const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
    setPeople(result.items.filter((item) => item.type === "CONTACT").map((item) => ({ value: item.value.split(":")[1] ?? "", label: locale === "zh-CN" ? item.labelZh : item.labelEn, detail: t("nav.people") })));
  }, [locale, t]);
  const searchHouseholds = useCallback(async (q: string) => {
    const result = await apiFetch<PageResult<HouseholdRecord>>(`/api/education?resource=households&page=1&pageSize=20&q=${encodeURIComponent(q)}`).catch(() => ({ items: [], total: 0, page: 1, pageSize: 20 }));
    setHouseholds(result.items.map((item) => ({ value: item.id, label: locale === "zh-CN" ? item.nameZh : item.nameEn, detail: t("nav.households") })));
  }, [locale, t]);
  const searchSchools = useCallback(async (q: string) => {
    if (q.trim().length < 2) return;
    const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
    setSchools(result.items.filter((item) => item.type === "ORGANIZATION").map((item) => ({ value: item.value.split(":")[1] ?? "", label: locale === "zh-CN" ? item.labelZh : item.labelEn, detail: t("nav.schools") })));
  }, [locale, t]);
  const openDetail = async (item: StudentRecord) => {
    setPending(true); setError("");
    try {
      const result = await apiFetch<{ item: StudentDetail }>(`/api/education?resource=studentDetail&id=${item.id}`);
      setDetail(result.item); setHousehold(result.item.householdId);
      if (result.item.householdId) setHouseholds([{ value: result.item.householdId, label: locale === "zh-CN" ? result.item.householdZh : result.item.householdEn }]);
    } catch (caught) { setError(presentApiError(caught, t, "education.loadFailed").message); } finally { setPending(false); }
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!person) { setError(t("education.personRequired")); return; }
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "createStudent", personId: person, householdId: household || null,
        studentNumber: form.get("studentNumber"), grade: form.get("grade"), academicYear: form.get("academicYear"),
      }) });
      setOpen(false); setPerson(""); setHousehold(""); await load(1); setToast(t("education.studentCreated"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const saveStudent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!detail) return;
    const form = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "updateStudent", id: detail.id, expectedUpdatedAt: detail.updatedAt,
        grade: form.get("grade"), academicYear: form.get("academicYear"), householdId: household || null, status: form.get("status"),
      }) });
      await load(); await openDetail(detail); setToast(t("education.studentUpdated"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const archiveStudent = async () => {
    if (!detail) return; setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "updateStudent", id: detail.id, expectedUpdatedAt: detail.updatedAt,
        grade: detail.grade, academicYear: detail.academicYear, householdId: detail.householdId || null, status: "ARCHIVED",
      }) });
      setDetail(null); await load(1); setToast(t("education.studentArchived"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const addAcademic = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!detail) return;
    const form = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "addAcademic", studentId: detail.id, schoolId: school || null,
        curriculum: form.get("curriculum"), grade: form.get("grade"), academicYear: form.get("academicYear"),
        validFrom: form.get("validFrom"), validTo: form.get("validTo") || null, status: form.get("status"),
      }) });
      event.currentTarget.reset(); setSchool(""); await openDetail(detail); setToast(t("education.academicAdded"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const saveGuardian = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();if(!detail||!guardianContact){setError(t("education.guardianRequired"));return;}
    const form=new FormData(event.currentTarget);setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        operation:"saveStudentGuardian",studentId:detail.id,contactId:guardianContact,
        relationship:form.get("relationship"),primary:form.get("primary")==="on",
        emergency:form.get("emergency")==="on",legalAuthority:form.get("legalAuthority")==="on",
      })});
      setGuardianContact("");await openDetail(detail);setToast(t("education.guardianSaved"));
    }catch(caught){setError(presentApiError(caught,t,"education.saveFailed").message);}finally{setPending(false);}
  };
  const removeGuardian=async(id:string)=>{
    if(!detail||!window.confirm(t("education.removeRelationshipConfirm")))return;
    setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"removeStudentGuardian",id})});
      await openDetail(detail);setToast(t("education.guardianRemoved"));
    }catch(caught){setError(presentApiError(caught,t,"education.saveFailed").message);}finally{setPending(false);}
  };
  return <div className="page-stack v200-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("education.eyebrow")}</p><h1>{t("education.students")}</h1><p>{t("education.studentsHelp")}</p></div>{canManage && <button className="primary-button" onClick={() => setOpen(true)}><Plus size={17}/>{t("education.newStudent")}</button>}</section>
    {error && <InlineMessage type="error">{error}</InlineMessage>}
    <section className="surface"><div className="table-toolbar"><SearchField value={query} onChange={setQuery} placeholder={t("education.searchStudents")}/><button className="secondary-button" onClick={() => void load(1)}>{t("common.search")}</button></div>
      <div className="v200-list">{data.items.map((item) => <article key={item.id}><span className="product-icon"><GraduationCap size={18}/></span><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{item.studentNumber || t("common.noData")} · {item.grade} · {item.academicYear}{item.householdZh ? ` · ${locale === "zh-CN" ? item.householdZh : item.householdEn}` : ""}</small></div><StatusBadge tone={statusTone(item.status)}>{t(`education.status.${item.status.toLowerCase()}`)}</StatusBadge><button className="secondary-button" disabled={pending} onClick={() => void openDetail(item)}>{t("common.details")}</button></article>)}</div>
      {!data.items.length && <div className="empty-state"><span>{t("education.studentsEmpty")}</span></div>}
      <Pagination page={data.page} totalPages={pages} total={data.total} pageSize={data.pageSize} onPage={(page) => void load(page)} onPageSize={(pageSize) => void load(1, pageSize)}/>
    </section>
    {open && <AccessibleDrawer title={t("education.newStudent")} onClose={() => setOpen(false)}><form onSubmit={create}><SearchableSelect label={t("education.person")} value={person} options={people} onChange={setPerson} onSearch={searchPeople}/><SearchableSelect label={t("education.householdOptional")} value={household} options={households} onChange={setHousehold} onSearch={searchHouseholds}/><label className="field"><span>{t("education.studentNumber")}</span><input name="studentNumber" maxLength={60}/></label><div className="form-grid two-column"><label className="field"><span>{t("education.grade")}</span><input name="grade" required maxLength={40}/></label><label className="field"><span>{t("education.academicYear")}</span><input name="academicYear" placeholder="2026-2027" required/></label></div>{error && <InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.saving") : t("common.create")}</button></div></form></AccessibleDrawer>}
    {detail && <AccessibleDrawer title={`${detail.nameZh} / ${detail.nameEn}`} description={t("education.detailHelp")} onClose={() => setDetail(null)}>
      <form onSubmit={saveStudent}><div className="form-grid two-column"><label className="field"><span>{t("education.grade")}</span><input name="grade" defaultValue={detail.grade} required/></label><label className="field"><span>{t("education.academicYear")}</span><input name="academicYear" defaultValue={detail.academicYear} required/></label></div><SearchableSelect label={t("education.householdOptional")} value={household} options={households} onChange={setHousehold} onSearch={searchHouseholds}/><label className="field"><span>{t("common.status")}</span><select name="status" defaultValue={detail.status}>{["ACTIVE","ON_LEAVE","ALUMNI","WITHDRAWN"].map((status) => <option value={status} key={status}>{t(`education.status.${status.toLowerCase()}`)}</option>)}</select></label>{error && <InlineMessage type="error">{error}</InlineMessage>}{canManage && <div className="drawer-actions"><button className="danger-button" type="button" disabled={pending} onClick={() => void archiveStudent()}>{t("education.archiveStudent")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.saving") : t("common.save")}</button></div>}</form>
      <section className="settings-subform"><h3>{t("education.guardians")}</h3><div className="v200-list">{detail.guardians.map((item) => <article key={item.id}><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{t(`education.guardian.${item.relationship.toLowerCase()}`)}{item.primary ? ` · ${t("education.primaryGuardian")}` : ""}{item.emergency?` · ${t("education.emergencyContact")}`:""}{item.legalAuthority?` · ${t("education.legalAuthority")}`:""}</small></div>{canManage&&<button className="icon-button danger" type="button" disabled={pending} aria-label={t("education.removeGuardian")} onClick={()=>void removeGuardian(item.id)}><Trash2 size={16}/></button>}</article>)}</div>{!detail.guardians.length && <p className="select-empty">{t("education.noGuardians")}</p>}{canManage&&<form onSubmit={saveGuardian} className="relationship-form"><SearchableSelect label={t("education.guardianContact")} value={guardianContact} options={people} onChange={setGuardianContact} onSearch={searchPeople}/><label className="field"><span>{t("education.guardianRelationship")}</span><select name="relationship">{["MOTHER","FATHER","GUARDIAN","RELATIVE","OTHER"].map(value=><option key={value} value={value}>{t(`education.guardian.${value.toLowerCase()}`)}</option>)}</select></label><div className="relationship-checks"><label className="checkbox-row"><input name="primary" type="checkbox"/><span>{t("education.primaryGuardian")}</span></label><label className="checkbox-row"><input name="emergency" type="checkbox"/><span>{t("education.emergencyContact")}</span></label><label className="checkbox-row"><input name="legalAuthority" type="checkbox"/><span>{t("education.legalAuthority")}</span></label></div><button className="secondary-button" disabled={pending||!guardianContact}><Plus size={16}/>{t("education.saveGuardian")}</button></form>}</section>
      <section className="settings-subform"><h3>{t("education.academicTimeline")}</h3><div className="v200-list">{detail.academicRecords.map((item) => <article key={item.id}><div><b>{item.academicYear} · {item.grade}</b><small>{item.curriculum}{item.schoolZh ? ` · ${locale === "zh-CN" ? item.schoolZh : item.schoolEn}` : ""} · {item.validFrom}{item.validTo ? ` → ${item.validTo}` : ""}</small></div><StatusBadge tone={item.status === "CURRENT" ? "green" : "amber"}>{t(`education.academic.${item.status.toLowerCase()}`)}</StatusBadge></article>)}</div>{!detail.academicRecords.length && <p className="select-empty">{t("education.noAcademicRecords")}</p>}{canManage && <form onSubmit={addAcademic}><SearchableSelect label={t("education.schoolOptional")} value={school} options={schools} onChange={setSchool} onSearch={searchSchools}/><div className="form-grid two-column"><label className="field"><span>{t("education.curriculum")}</span><input name="curriculum" required/></label><label className="field"><span>{t("education.grade")}</span><input name="grade" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("education.academicYear")}</span><input name="academicYear" required/></label><label className="field"><span>{t("common.status")}</span><select name="status"><option value="CURRENT">{t("education.academic.current")}</option><option value="COMPLETED">{t("education.academic.completed")}</option><option value="PLANNED">{t("education.academic.planned")}</option></select></label></div><div className="form-grid two-column"><label className="field"><span>{t("education.validFrom")}</span><input name="validFrom" type="date" required/></label><label className="field"><span>{t("education.validTo")}</span><input name="validTo" type="date"/></label></div><button className="secondary-button" disabled={pending}>{t("education.addAcademic")}</button></form>}</section>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

export function HouseholdsWorkspace({ initial, initialDetail = null }: { initial: PageResult<HouseholdRecord>; initialDetail?: HouseholdDetail | null }) {
  const { locale, t } = useI18n();
  const canManage = useCapability("education.manage");
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const [detail, setDetail] = useState<HouseholdDetail | null>(initialDetail);
  const [memberContact,setMemberContact]=useState("");
  const [memberOptions,setMemberOptions]=useState<Array<{value:string;label:string;detail?:string}>>([]);
  const load = async (page = data.page, pageSize = data.pageSize) => {
    try { setData(await apiFetch<PageResult<HouseholdRecord>>(`/api/education?resource=households&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`)); setError(""); }
    catch (caught) { setError(presentApiError(caught, t, "education.loadFailed").message); }
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "createHousehold", nameZh: form.get("nameZh"), nameEn: form.get("nameEn"), address: form.get("address") }) });
      setOpen(false); await load(1); setToast(t("education.householdCreated"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const openDetail = async (item: HouseholdRecord) => {
    setPending(true); setError("");
    try { setDetail((await apiFetch<{ item: HouseholdDetail }>(`/api/education?resource=householdDetail&id=${item.id}`)).item); }
    catch (caught) { setError(presentApiError(caught, t, "education.loadFailed").message); } finally { setPending(false); }
  };
  const saveHousehold = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!detail) return; const form = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "updateHousehold", id: detail.id, expectedUpdatedAt: detail.updatedAt,
        nameZh: form.get("nameZh"), nameEn: form.get("nameEn"), address: form.get("address"), status: form.get("status"),
      }) });
      setDetail(null); await load(); setToast(t("education.householdUpdated"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const archiveHousehold = async () => {
    if (!detail) return; setPending(true); setError("");
    try {
      await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operation: "updateHousehold", id: detail.id, expectedUpdatedAt: detail.updatedAt,
        nameZh: detail.nameZh, nameEn: detail.nameEn, address: detail.address, status: "ARCHIVED",
      }) });
      setDetail(null); await load(1); setToast(t("education.householdArchived"));
    } catch (caught) { setError(presentApiError(caught, t, "education.saveFailed").message); } finally { setPending(false); }
  };
  const searchMembers=useCallback(async(q:string)=>{
    if(q.trim().length<2)return;
    const result=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?q=${encodeURIComponent(q)}`).catch(()=>({items:[]}));
    setMemberOptions(result.items.filter(item=>item.type==="CONTACT").map(item=>({value:item.value.split(":")[1]??"",label:locale==="zh-CN"?item.labelZh:item.labelEn,detail:t("nav.people")})));
  },[locale,t]);
  const saveMember=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!detail||!memberContact){setError(t("education.memberRequired"));return;}
    const form=new FormData(event.currentTarget);setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        operation:"saveHouseholdMember",householdId:detail.id,contactId:memberContact,
        role:form.get("role"),primary:form.get("primary")==="on",
      })});
      setMemberContact("");await openDetail(detail);setToast(t("education.memberSaved"));
    }catch(caught){setError(presentApiError(caught,t,"education.saveFailed").message);}finally{setPending(false);}
  };
  const removeMember=async(id:string)=>{
    if(!detail||!window.confirm(t("education.removeRelationshipConfirm")))return;
    setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"removeHouseholdMember",id})});
      await openDetail(detail);setToast(t("education.memberRemoved"));
    }catch(caught){setError(presentApiError(caught,t,"education.saveFailed").message);}finally{setPending(false);}
  };
  return <div className="page-stack v200-workspace"><section className="page-heading-row"><div><p className="eyebrow">{t("education.eyebrow")}</p><h1>{t("education.households")}</h1><p>{t("education.householdsHelp")}</p></div>{canManage && <button className="primary-button" onClick={() => setOpen(true)}><Plus size={17}/>{t("education.newHousehold")}</button>}</section>
    {error && !detail && <InlineMessage type="error">{error}</InlineMessage>}<section className="surface"><div className="table-toolbar"><SearchField value={query} onChange={setQuery} placeholder={t("education.searchHouseholds")}/><button className="secondary-button" onClick={() => void load(1)}>{t("common.search")}</button></div><div className="v200-list">{data.items.map((item) => <article key={item.id}><span className="product-icon"><Home size={18}/></span><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{item.address || t("common.noData")} · {t("education.memberCount", { count: item.memberCount })}</small></div><StatusBadge tone={statusTone(item.status)}>{t(`education.status.${item.status.toLowerCase()}`)}</StatusBadge><button className="secondary-button" disabled={pending} onClick={() => void openDetail(item)}>{t("common.details")}</button></article>)}</div>{!data.items.length && <div className="empty-state"><span>{t("education.householdsEmpty")}</span></div>}<Pagination page={data.page} totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={(page) => void load(page)} onPageSize={(size) => void load(1, size)}/></section>
    {open && <AccessibleDrawer title={t("education.newHousehold")} onClose={() => setOpen(false)}><form onSubmit={create}><div className="form-grid two-column"><label className="field"><span>{t("education.nameZh")}</span><input name="nameZh" required/></label><label className="field"><span>{t("education.nameEn")}</span><input name="nameEn" required/></label></div><label className="field"><span>{t("education.address")}</span><textarea name="address" rows={3}/></label>{error && <InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.saving") : t("common.create")}</button></div></form></AccessibleDrawer>}
    {detail && <AccessibleDrawer title={`${detail.nameZh} / ${detail.nameEn}`} description={t("education.householdDetailHelp")} onClose={() => setDetail(null)}><form onSubmit={saveHousehold}><div className="form-grid two-column"><label className="field"><span>{t("education.nameZh")}</span><input name="nameZh" defaultValue={detail.nameZh} required/></label><label className="field"><span>{t("education.nameEn")}</span><input name="nameEn" defaultValue={detail.nameEn} required/></label></div><label className="field"><span>{t("education.address")}</span><textarea name="address" rows={3} defaultValue={detail.address}/></label><label className="field"><span>{t("common.status")}</span><select name="status" defaultValue={detail.status}><option value="ACTIVE">{t("education.status.active")}</option><option value="INACTIVE">{t("education.status.inactive")}</option></select></label>{error && <InlineMessage type="error">{error}</InlineMessage>}{canManage && <div className="drawer-actions"><button className="danger-button" type="button" disabled={pending} onClick={() => void archiveHousehold()}>{t("education.archiveHousehold")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.saving") : t("common.save")}</button></div>}</form><section className="settings-subform"><h3>{t("education.householdMembers")}</h3><div className="v200-list">{detail.members.map((item) => <article key={item.id}><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{t(`education.memberRole.${item.role.toLowerCase()}`)}{item.primary ? ` · ${t("education.primaryContact")}` : ""}</small></div>{canManage&&<button className="icon-button danger" type="button" disabled={pending} aria-label={t("education.removeMember")} onClick={()=>void removeMember(item.id)}><Trash2 size={16}/></button>}</article>)}</div>{!detail.members.length && <p className="select-empty">{t("education.noHouseholdMembers")}</p>}{canManage&&<form className="relationship-form" onSubmit={saveMember}><SearchableSelect label={t("education.memberContact")} value={memberContact} options={memberOptions} onChange={setMemberContact} onSearch={searchMembers}/><label className="field"><span>{t("education.memberRole")}</span><select name="role">{["PARENT","GUARDIAN","STUDENT","PAYER","OTHER"].map(value=><option key={value} value={value}>{t(`education.memberRole.${value.toLowerCase()}`)}</option>)}</select></label><label className="checkbox-row"><input name="primary" type="checkbox"/><span>{t("education.primaryContact")}</span></label><button className="secondary-button" disabled={pending||!memberContact}><Plus size={16}/>{t("education.saveMember")}</button></form>}</section></AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

export function ProgressionWorkspace({ initial }: { initial: PageResult<ProgressionBatchRecord> }) {
  const { locale,t } = useI18n();
  const [data, setData] = useState(initial);
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const [detail,setDetail]=useState<{batch:ProgressionBatchRecord;items:ProgressionItemRecord[]}|null>(null);
  const [rules,setRules]=useState<ProgressionRuleRecord[]|null>(null);
  const [ruleDraft,setRuleDraft]=useState<ProgressionRuleRecord|null>(null);
  const reload = async (page = data.page, pageSize = data.pageSize) => {
    try{setData(await apiFetch<PageResult<ProgressionBatchRecord>>(`/api/education?resource=progression&page=${page}&pageSize=${pageSize}`));setError("");}
    catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}
  };
  const openBatch=async(item:ProgressionBatchRecord)=>{
    setPending(true);setError("");
    try{setDetail(await apiFetch<{batch:ProgressionBatchRecord;items:ProgressionItemRecord[]}>(`/api/education?resource=progressionDetail&id=${item.id}`));}
    catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}finally{setPending(false);}
  };
  const preview = async (event: React.FormEvent) => {
    event.preventDefault(); setPending(true); setError("");
    try { await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "previewProgression", fromYear, toYear, requestKey: crypto.randomUUID() }) }); await reload(); setToast(t("progression.previewReady")); }
    catch (caught) { setError(presentApiError(caught, t, "progression.failed").message); } finally { setPending(false); }
  };
  const apply = async (item: ProgressionBatchRecord) => {
    setPending(true); setError("");
    try { await apiFetch("/api/education", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "applyProgression", id: item.id, requestKey: crypto.randomUUID() }) }); setDetail(null);await reload(); setToast(t("progression.applied")); }
    catch (caught) { setError(presentApiError(caught, t, "progression.failed").message); } finally { setPending(false); }
  };
  const saveItem=async(event:React.FormEvent<HTMLFormElement>,item:ProgressionItemRecord)=>{
    event.preventDefault();if(!detail)return;const form=new FormData(event.currentTarget);setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"updateProgressionItem",id:item.id,selected:form.get("selected")==="on",toGrade:form.get("toGrade"),action:form.get("action"),reason:form.get("reason")})});
      await openBatch(detail.batch);setToast(t("progression.itemSaved"));
    }catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}finally{setPending(false);}
  };
  const cancel=async(item:ProgressionBatchRecord)=>{
    if(!window.confirm(t("progression.cancelConfirm")))return;setPending(true);setError("");
    try{await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"cancelProgression",id:item.id})});setDetail(null);await reload();setToast(t("progression.cancelled"));}
    catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}finally{setPending(false);}
  };
  const loadRules=async()=>{
    setPending(true);setError("");
    try{setRules((await apiFetch<{items:ProgressionRuleRecord[]}>("/api/education?resource=progressionRules")).items);}
    catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}finally{setPending(false);}
  };
  const saveRule=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const form=new FormData(event.currentTarget);setPending(true);setError("");
    try{
      await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"saveProgressionRule",id:ruleDraft?.id||null,fromGrade:form.get("fromGrade"),toGrade:form.get("toGrade"),action:form.get("action"),active:form.get("active")==="on"})});
      setRuleDraft(null);await loadRules();setToast(t("progression.ruleSaved"));
    }catch(caught){setError(presentApiError(caught,t,"progression.failed").message);}finally{setPending(false);}
  };
  return <div className="page-stack v200-workspace"><section className="page-heading-row"><div><p className="eyebrow">{t("progression.eyebrow")}</p><h1>{t("progression.title")}</h1><p>{t("progression.help")}</p></div><button className="secondary-button" disabled={pending} onClick={()=>void loadRules()}><Save size={16}/>{t("progression.rules")}</button></section>{error && <InlineMessage type="error">{error}</InlineMessage>}<form className="surface v200-action-form" onSubmit={preview}><div className="form-grid two-column"><label className="field"><span>{t("progression.fromYear")}</span><input value={fromYear} onChange={(event) => setFromYear(event.target.value)} placeholder="2025-2026" required/></label><label className="field"><span>{t("progression.toYear")}</span><input value={toYear} onChange={(event) => setToYear(event.target.value)} placeholder="2026-2027" required/></label></div><InlineMessage type="warning">{t("progression.confirmHelp")}</InlineMessage><button className="primary-button" disabled={pending}><RefreshCw size={16}/>{t("progression.preview")}</button></form>
  {rules&&<section className="surface progression-rules"><div className="surface-heading"><div><p className="eyebrow">{t("progression.rulesEyebrow")}</p><h2>{t("progression.rules")}</h2><p>{t("progression.rulesHelp")}</p></div><button className="primary-button" type="button" onClick={()=>setRuleDraft({id:"",fromGrade:"",toGrade:"",action:"ADVANCE",active:true,updatedAt:""})}><Plus size={16}/>{t("progression.newRule")}</button></div>{ruleDraft&&<form className="form-grid progression-rule-form" onSubmit={saveRule}><label className="field"><span>{t("progression.fromGrade")}</span><input name="fromGrade" defaultValue={ruleDraft.fromGrade} required/></label><label className="field"><span>{t("progression.toGrade")}</span><input name="toGrade" defaultValue={ruleDraft.toGrade} required/></label><label className="field"><span>{t("progression.action")}</span><select name="action" defaultValue={ruleDraft.action}><option value="ADVANCE">{t("progression.action.advance")}</option><option value="GRADUATE">{t("progression.action.graduate")}</option></select></label><label className="checkbox-row"><input name="active" type="checkbox" defaultChecked={ruleDraft.active}/><span>{t("progression.ruleActive")}</span></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setRuleDraft(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Save size={16}/>{t("common.save")}</button></div></form>}<div className="v200-list">{rules.map(rule=><article key={rule.id}><div><b>{rule.fromGrade} → {rule.toGrade}</b><small>{t(`progression.action.${rule.action.toLowerCase()}`)}</small></div><StatusBadge tone={rule.active?"green":"gray"}>{t(rule.active?"progression.ruleActive":"progression.ruleInactive")}</StatusBadge><button className="secondary-button" type="button" onClick={()=>setRuleDraft(rule)}>{t("common.edit")}</button></article>)}</div></section>}
  <section className="surface"><div className="v200-list">{data.items.map((item) => <article key={item.id}><span className="product-icon"><GraduationCap size={18}/></span><div><b>{item.fromYear} → {item.toYear}</b><small>{t("progression.selected", { count: item.selected })} · {t("progression.appliedCount", { count: item.applied })}</small></div><StatusBadge tone={statusTone(item.status)}>{t(`progression.status.${item.status.toLowerCase()}`)}</StatusBadge><button className="secondary-button" disabled={pending} onClick={() => void openBatch(item)}>{t("progression.review")}</button></article>)}</div>{!data.items.length && <div className="empty-state"><span>{t("progression.empty")}</span></div>}<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={(page)=>void reload(page)} onPageSize={(pageSize)=>void reload(1,pageSize)}/></section>
  {detail&&<AccessibleDrawer title={`${detail.batch.fromYear} → ${detail.batch.toYear}`} description={t("progression.reviewHelp")} onClose={()=>setDetail(null)}><div className="progression-items">{detail.items.map(item=><form className="progression-item" key={item.id} onSubmit={event=>void saveItem(event,item)}><div className="progression-item-heading"><div><b>{locale==="zh-CN"?item.nameZh:item.nameEn}</b><small>{item.fromGrade} → {item.toGrade}</small></div><StatusBadge tone={statusTone(item.status)}>{t(`progression.itemStatus.${item.status.toLowerCase()}`)}</StatusBadge></div><div className="form-grid two-column"><label className="field"><span>{t("progression.toGrade")}</span><input name="toGrade" defaultValue={item.toGrade} required/></label><label className="field"><span>{t("progression.action")}</span><select name="action" defaultValue={item.action}>{["ADVANCE","GRADUATE","HOLD"].map(action=><option key={action} value={action}>{t(`progression.action.${action.toLowerCase()}`)}</option>)}</select></label></div><label className="field"><span>{t("progression.reason")}</span><input name="reason" defaultValue={item.reason}/></label><label className="checkbox-row"><input name="selected" type="checkbox" defaultChecked={item.selected}/><span>{t("progression.includeStudent")}</span></label>{item.errorCode&&<InlineMessage type="warning">{item.errorCode}</InlineMessage>}{detail.batch.status==="PREVIEWED"&&<button className="secondary-button" disabled={pending}><Save size={15}/>{t("progression.saveItem")}</button>}</form>)}</div>{!detail.items.length&&<p className="select-empty">{t("progression.noItems")}</p>}{detail.batch.status==="PREVIEWED"&&<div className="drawer-actions"><button className="danger-button" type="button" disabled={pending} onClick={()=>void cancel(detail.batch)}><XCircle size={16}/>{t("progression.cancelBatch")}</button><button className="primary-button" type="button" disabled={pending||!detail.items.some(item=>item.selected&&item.action!=="HOLD")} onClick={()=>void apply(detail.batch)}><CheckCircle2 size={16}/>{t("progression.apply")}</button></div>}</AccessibleDrawer>}{toast && <Toast message={toast} onClose={() => setToast("")}/>}</div>;
}

export function LeadsWorkspace({ initial, focusedLead = null }: { initial: PageResult<LeadRecord>; focusedLead?: LeadRecord | null }) {
  const { locale, t } = useI18n();
  const canManage = useCapability("leads.manage");
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"SCHOOL" | "HOUSEHOLD">("SCHOOL");
  const [subject, setSubject] = useState("");
  const [subjectOptions, setSubjectOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending,setPending]=useState(false);
  const [converting,setConverting]=useState<LeadRecord|null>(focusedLead);
  const load = async (page = data.page, pageSize = data.pageSize) => {
    try{setData(await apiFetch<PageResult<LeadRecord>>(`/api/leads?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`));setError("");}
    catch(caught){setError(presentApiError(caught,t,"leads.loadFailed").message);}
  };
  const searchSubject = useCallback(async (q: string) => {
    if (type === "SCHOOL") {
      const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
      setSubjectOptions(result.items.filter((item) => item.type === "ORGANIZATION").map((item) => ({ value: item.value.split(":")[1] ?? "", label: locale === "zh-CN" ? item.labelZh : item.labelEn, detail: t("nav.schools") })));
    } else {
      const result = await apiFetch<PageResult<HouseholdRecord>>(`/api/education?resource=households&q=${encodeURIComponent(q)}`).catch(() => ({ items: [], total: 0, page: 1, pageSize: 20 }));
      setSubjectOptions(result.items.map((item) => ({ value: item.id, label: locale === "zh-CN" ? item.nameZh : item.nameEn, detail: t("nav.households") })));
    }
  }, [locale, t, type]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
    if(!subject){setError(t("leads.subjectRequired"));return;}setPending(true);
    try { await apiFetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "create", type, organizationId: type === "SCHOOL" ? subject : null, householdId: type === "HOUSEHOLD" ? subject : null, nameZh: form.get("nameZh"), nameEn: form.get("nameEn"), source: form.get("source"), score: Number(form.get("score")), note: form.get("note") }) }); setOpen(false);setSubject(""); await load(1); setToast(t("leads.created")); }
    catch (caught) { setError(presentApiError(caught, t, "leads.saveFailed").message); }finally{setPending(false);}
  };
  const convert = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();if(!converting)return;const form=new FormData(event.currentTarget);setPending(true);setError("");
    try { await apiFetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "convert", id: converting.id, titleZh: form.get("titleZh"), titleEn: form.get("titleEn"), amount: Number(form.get("amount")), currency: form.get("currency"), requestKey: crypto.randomUUID() }) });setConverting(null);await load(); setToast(t("leads.converted")); }
    catch (caught) { setError(presentApiError(caught, t, "leads.convertFailed").message); }finally{setPending(false);}
  };
  return <div className="page-stack v200-workspace"><section className="page-heading-row"><div><p className="eyebrow">{t("leads.eyebrow")}</p><h1>{t("leads.title")}</h1><p>{t("leads.help")}</p></div>{canManage && <button className="primary-button" onClick={() => setOpen(true)}><Plus size={17}/>{t("leads.new")}</button>}</section>{error&&!open&&!converting&&<InlineMessage type="error">{error}</InlineMessage>}<section className="surface"><div className="table-toolbar"><SearchField value={query} onChange={setQuery} placeholder={t("leads.search")}/><button className="secondary-button" onClick={() => void load(1)}>{t("common.search")}</button></div><div className="v200-list">{data.items.map((item) => <article key={item.id}><span className="product-icon"><Target size={18}/></span><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{t(`leads.type.${item.type.toLowerCase()}`)} · {item.source} · {t("leads.score", { score: item.score })}</small></div><StatusBadge tone={statusTone(item.status)}>{t(`leads.status.${item.status.toLowerCase()}`)}</StatusBadge><button className="secondary-button" onClick={()=>{setConverting(item);setError("");}}>{item.status==="QUALIFIED"&&canManage?t("leads.convert"):t("common.details")}</button></article>)}</div>{!data.items.length && <div className="empty-state"><span>{t("leads.empty")}</span></div>}<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={(page)=>void load(page)} onPageSize={(pageSize)=>void load(1,pageSize)}/></section>
    {open && <AccessibleDrawer title={t("leads.new")} onClose={() => setOpen(false)}><form onSubmit={create}><label className="field"><span>{t("leads.type")}</span><select value={type} onChange={(event) => { setType(event.target.value as typeof type); setSubject(""); setSubjectOptions([]); }}><option value="SCHOOL">{t("leads.type.school")}</option><option value="HOUSEHOLD">{t("leads.type.household")}</option></select></label><SearchableSelect label={t("leads.subject")} value={subject} options={subjectOptions} onChange={setSubject} onSearch={searchSubject}/><div className="form-grid two-column"><label className="field"><span>{t("education.nameZh")}</span><input name="nameZh" required/></label><label className="field"><span>{t("education.nameEn")}</span><input name="nameEn" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("leads.source")}</span><input name="source" required/></label><label className="field"><span>{t("leads.scoreLabel")}</span><input name="score" type="number" min="0" max="100" defaultValue="50" required/></label></div><label className="field"><span>{t("leads.note")}</span><textarea name="note" rows={3}/></label>{error && <InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.saving"):t("common.create")}</button></div></form></AccessibleDrawer>}
    {converting&&<AccessibleDrawer title={`${converting.nameZh} / ${converting.nameEn}`} description={t("leads.detailHelp")} onClose={()=>setConverting(null)}><div className="lead-facts"><p><b>{t("leads.type")}</b><span>{t(`leads.type.${converting.type.toLowerCase()}`)}</span></p><p><b>{t("leads.source")}</b><span>{converting.source}</span></p><p><b>{t("leads.scoreLabel")}</b><span>{converting.score}</span></p><p><b>{t("common.status")}</b><span>{t(`leads.status.${converting.status.toLowerCase()}`)}</span></p></div>{converting.status==="QUALIFIED"&&canManage?<form onSubmit={convert}><InlineMessage type="info">{t("leads.convertHelp")}</InlineMessage><div className="form-grid two-column"><label className="field"><span>{t("leads.titleZh")}</span><input name="titleZh" defaultValue={`${converting.nameZh} 商机`} required/></label><label className="field"><span>{t("leads.titleEn")}</span><input name="titleEn" defaultValue={`${converting.nameEn} opportunity`} required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("leads.amount")}</span><input name="amount" type="number" min="0" step="0.01" defaultValue="0" required/></label><label className="field"><span>{t("leads.currency")}</span><select name="currency" defaultValue="CNY">{["CNY","USD","HKD","TWD","EUR","GBP"].map(value=><option key={value}>{value}</option>)}</select></label></div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setConverting(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Target size={16}/>{pending?t("common.processing"):t("leads.convert")}</button></div></form>:<InlineMessage type="info">{t(converting.status==="CONVERTED"?"leads.alreadyConverted":"leads.notQualified")}</InlineMessage>}</AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}</div>;
}

export function PrivacyRequestsWorkspace({ initial }: { initial: PageResult<PrivacyRequestRecord> }) {
  const { locale, t } = useI18n();
  const canManage = useCapability("privacyRequests.manage");
  const [data, setData] = useState(initial);
  const [contact, setContact] = useState("");
  const [contactOptions, setContactOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [reviewing, setReviewing] = useState<PrivacyRequestRecord | null>(null);
  const [nextStatus, setNextStatus] = useState("");
  const [identityStatus, setIdentityStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const reload = async (page = data.page, pageSize = data.pageSize) => {
    setData(await apiFetch<PageResult<PrivacyRequestRecord>>(`/api/privacy-requests?page=${page}&pageSize=${pageSize}`));
  };
  const searchContacts = useCallback(async (query: string) => {
    if (query.trim().length < 2) return;
    const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(query)}`).catch(() => ({ items: [] }));
    setContactOptions(result.items.filter((item) => item.type === "CONTACT").map((item) => ({
      value: item.value.split(":")[1] ?? "",
      label: locale === "zh-CN" ? item.labelZh : item.labelEn,
      detail: t("nav.people"),
    })));
  }, [locale, t]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
    if (!contact) { setError(t("privacyRequests.contactRequired")); return; }
    setPending(true);
    try {
      await apiFetch("/api/privacy-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "create", type: form.get("type"), note: form.get("note"), contactId: contact }) });
      event.currentTarget.reset(); setContact(""); await reload(1); setToast(t("privacyRequests.created"));
    } catch (caught) { setError(presentApiError(caught, t, "privacyRequests.failed").message); } finally { setPending(false); }
  };
  const availableStatuses = (item: PrivacyRequestRecord) => {
    if (item.status === "RECEIVED") return ["IDENTITY_REVIEW", "CANCELLED"];
    if (item.status === "IDENTITY_REVIEW") return ["IN_PROGRESS", "REJECTED", "CANCELLED"];
    if (item.status === "IN_PROGRESS") return item.type === "EXPORT" || item.type === "DELETION"
      ? ["WAITING_APPROVAL", "REJECTED", "CANCELLED"] : ["FULFILLED", "REJECTED", "CANCELLED"];
    if (item.status === "WAITING_APPROVAL") return ["FULFILLED", "REJECTED"];
    return [];
  };
  const openReview = (item: PrivacyRequestRecord) => {
    const statuses = availableStatuses(item);
    setReviewing(item);
    setNextStatus(statuses[0] ?? "");
    setIdentityStatus(item.status === "IDENTITY_REVIEW" ? "VERIFIED" : item.identityStatus);
    setError("");
  };
  const manage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewing || !nextStatus) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      await apiFetch("/api/privacy-requests", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "manage", id: reviewing.id, status: nextStatus, identityStatus, decision: form.get("decision") }),
      });
      setReviewing(null); await reload(); setToast(t("privacyRequests.updated"));
    } catch (caught) { setError(presentApiError(caught, t, "privacyRequests.manageFailed").message); } finally { setPending(false); }
  };
  return <div className="page-stack v200-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("privacyRequests.eyebrow")}</p><h1>{t("privacyRequests.title")}</h1><p>{t("privacyRequests.help")}</p></div></section>
    <InlineMessage type="info">{t("privacyRequests.identityHelp")}</InlineMessage>
    <form className="surface v200-action-form" onSubmit={submit}>
      <SearchableSelect label={t("privacyRequests.contact")} value={contact} options={contactOptions} onChange={setContact} onSearch={searchContacts}/>
      <label className="field"><span>{t("privacyRequests.type")}</span><select name="type">{["ACCESS","EXPORT","CORRECTION","RESTRICTION","DELETION"].map((type) => <option value={type} key={type}>{t(`privacyRequests.type.${type.toLowerCase()}`)}</option>)}</select></label>
      <label className="field"><span>{t("privacyRequests.note")}</span><textarea name="note" minLength={10} rows={4} required/></label>
      {error && !reviewing && <InlineMessage type="error">{error}</InlineMessage>}
      <button className="primary-button" disabled={pending}><ShieldCheck size={16}/>{pending ? t("common.processing") : t("privacyRequests.submit")}</button>
    </form>
    <section className="surface"><div className="v200-list">{data.items.map((item) => <article key={item.id}>
      <span className="product-icon"><ShieldCheck size={18}/></span>
      <div><b>{t(`privacyRequests.type.${item.type.toLowerCase()}`)}</b><small>{item.note} · {t("privacyRequests.identity", { status: t(`privacyRequests.identity.${item.identityStatus.toLowerCase()}`) })} · {t("privacyRequests.due", { date: item.dueAt.slice(0, 10) })}</small></div>
      <StatusBadge tone={statusTone(item.status)}>{t(`privacyRequests.status.${item.status.toLowerCase()}`)}</StatusBadge>
      {canManage && availableStatuses(item).length > 0 && <button className="secondary-button" onClick={() => openReview(item)}>{t("privacyRequests.review")}</button>}
    </article>)}</div>
      {!data.items.length && <div className="empty-state"><span>{t("privacyRequests.empty")}</span></div>}
      <Pagination page={data.page} totalPages={pages} total={data.total} pageSize={data.pageSize} onPage={(page) => void reload(page)} onPageSize={(pageSize) => void reload(1, pageSize)}/>
    </section>
    {reviewing && <AccessibleDrawer title={t("privacyRequests.reviewTitle")} description={t("privacyRequests.reviewHelp")} onClose={() => setReviewing(null)}>
      <form onSubmit={manage}>
        <label className="field"><span>{t("privacyRequests.nextStatus")}</span><select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{availableStatuses(reviewing).map((status) => <option key={status} value={status}>{t(`privacyRequests.status.${status.toLowerCase()}`)}</option>)}</select></label>
        <label className="field"><span>{t("privacyRequests.identityStatus")}</span><select value={identityStatus} onChange={(event) => setIdentityStatus(event.target.value)}>{["PENDING","VERIFIED","FAILED"].map((status) => <option key={status} value={status}>{t(`privacyRequests.identity.${status.toLowerCase()}`)}</option>)}</select></label>
        <label className="field"><span>{t("privacyRequests.decision")}</span><textarea name="decision" rows={4} minLength={3} maxLength={2000} required/></label>
        {(reviewing.type === "EXPORT" || reviewing.type === "DELETION") && <InlineMessage type="warning">{t("privacyRequests.dualReview")}</InlineMessage>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setReviewing(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.processing") : t("common.confirm")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

export function SuggestionsWorkspace({ initial }: { initial: PageResult<SuggestionRecord> }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState<SuggestionRecord | null>(null);
  const [view,setView]=useState<"OPEN"|"history">("OPEN");
  const [asOf] = useState(Date.now);
  const openItems = useMemo(() => data.items.filter((item) => item.status === "OPEN" && new Date(item.expiresAt).getTime() > asOf), [asOf, data.items]);
  const expiredItems = useMemo(() => data.items.filter((item) => item.status === "OPEN" && new Date(item.expiresAt).getTime() <= asOf), [asOf, data.items]);
  const reload = async (page = data.page, pageSize = data.pageSize, status = view) => {
    try{setData(await apiFetch<PageResult<SuggestionRecord>>(`/api/ai-suggestions?page=${page}&pageSize=${pageSize}&status=${status}`));setError("");}
    catch(caught){setError(presentApiError(caught,t,"ai.failed").message);}
  };
  const changeView=async(next:"OPEN"|"history")=>{setView(next);setReviewing(null);await reload(1,data.pageSize,next);};
  const generate = async () => {
    setPending(true); setError("");
    try { await apiFetch("/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "generate" }) }); await reload(); setToast(t("ai.generated")); }
    catch (caught) { setError(presentApiError(caught, t, "ai.failed").message); } finally { setPending(false); }
  };
  const decide = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!reviewing) return; const form = new FormData(event.currentTarget);
    const decision = String(form.get("decision")) as "ACCEPTED" | "EDITED" | "REJECTED";
    setPending(true); setError("");
    try { await apiFetch("/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "decide", id: reviewing.id, decision, finalZh: form.get("finalZh"), finalEn: form.get("finalEn"), reason: form.get("reason"), createTask: form.get("createTask") === "on" && decision !== "REJECTED", requestKey: crypto.randomUUID() }) }); setReviewing(null); await reload(); setToast(t("ai.decisionSaved")); }
    catch (caught) { setError(presentApiError(caught, t, "ai.failed").message); } finally { setPending(false); }
  };
  const visibleItems=view==="OPEN"?openItems:data.items;
  return <div className="page-stack v200-workspace"><section className="page-heading-row"><div><p className="eyebrow">{t("ai.eyebrow")}</p><h1>{t("ai.title")}</h1><p>{t("ai.help")}</p></div><button className="primary-button" disabled={pending} onClick={() => void generate()}><Sparkles size={17}/>{t("ai.generate")}</button></section><InlineMessage type="warning">{t("ai.humanReview")}</InlineMessage>{view==="OPEN"&&expiredItems.length > 0 && <InlineMessage type="info">{t("ai.expiredCount",{count:expiredItems.length})}</InlineMessage>}{error && !reviewing && <InlineMessage type="error">{error}</InlineMessage>}<section className="surface"><div className="segmented-control suggestion-tabs" aria-label={t("ai.view")}><button type="button" className={view==="OPEN"?"active":""} onClick={()=>void changeView("OPEN")}><Sparkles size={15}/>{t("ai.open")}</button><button type="button" className={view==="history"?"active":""} onClick={()=>void changeView("history")}><History size={15}/>{t("ai.history")}</button></div><div className="v200-list suggestions">{visibleItems.map((item) => <article key={item.id}><span className="product-icon"><BrainCircuit size={18}/></span><div><b>{locale === "zh-CN" ? item.recommendationZh : item.recommendationEn}</b><small>{t("ai.confidence", { value: Math.round(item.confidence * 100) })} · {view==="OPEN"?t("ai.expires",{date:item.expiresAt.slice(0,10)}):t("ai.created",{date:item.createdAt.slice(0,10)})}</small><small>{item.evidence.map((entry) => `${t(`ai.evidence.${String(entry.type??"unknown").toLowerCase()}`)}${entry.value?`: ${String(entry.value)}`:""}`).join(" · ")}</small></div>{view==="OPEN"?<button className="primary-button" disabled={pending} onClick={() => setReviewing(item)}>{t("ai.review")}</button>:<StatusBadge tone={statusTone(item.status)}>{t(`ai.status.${item.status.toLowerCase()}`)}</StatusBadge>}</article>)}</div>{!visibleItems.length && <div className="empty-state"><span>{t(view==="OPEN"?"ai.empty":"ai.historyEmpty")}</span></div>}<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={(page)=>void reload(page)} onPageSize={(pageSize)=>void reload(1,pageSize)}/></section>{reviewing&&<AccessibleDrawer title={t("ai.reviewTitle")} description={t("ai.reviewHelp")} onClose={()=>setReviewing(null)}><form onSubmit={decide}><label className="field"><span>{t("ai.decision")}</span><select name="decision" defaultValue="ACCEPTED"><option value="ACCEPTED">{t("ai.accept")}</option><option value="EDITED">{t("ai.editAccept")}</option><option value="REJECTED">{t("ai.reject")}</option></select></label><label className="field"><span>{t("ai.finalZh")}</span><textarea name="finalZh" rows={3} defaultValue={reviewing.recommendationZh}/></label><label className="field"><span>{t("ai.finalEn")}</span><textarea name="finalEn" rows={3} defaultValue={reviewing.recommendationEn}/></label><label className="field"><span>{t("ai.reason")}</span><textarea name="reason" rows={3} minLength={3} required defaultValue={t("ai.acceptReason")}/></label><label className="checkbox-row"><input type="checkbox" name="createTask" defaultChecked/><span>{t("ai.createTask")}</span></label><InlineMessage type="info">{t("ai.evidenceHelp")}: {reviewing.evidence.map((entry)=>`${t(`ai.evidence.${String(entry.type??"unknown").toLowerCase()}`)}${entry.value?`: ${String(entry.value)}`:""}`).join(" · ")}</InlineMessage>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setReviewing(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.processing"):t("common.confirm")}</button></div></form></AccessibleDrawer>}{toast && <Toast message={toast} onClose={() => setToast("")}/>}</div>;
}
