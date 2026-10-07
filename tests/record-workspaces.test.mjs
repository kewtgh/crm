import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {studentWorkspaceTabs,accountWorkspaceTabs,studentUpdateInput,recordFocusHref,safeRecordReturn} from '../lib/record-workspace-presentation.ts';
import {studentRecord} from './fixtures/record-workspaces.ts';
import {recordWorkspaceZh,recordWorkspaceEn} from '../lib/i18n/locales/record-workspaces.ts';
const source=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('Student and Account have bounded same-record navigation, independent from global routes',()=>{
 assert.deepEqual(studentWorkspaceTabs.map(t=>t.key),['profile','family','journey','academic']);
 assert.deepEqual(accountWorkspaceTabs.map(t=>t.key),['overview','people','opportunities','business','commercial','activity']);
 assert.equal(new Set(accountWorkspaceTabs.map(t=>t.key)).size,6);
});
test('partial Student edit preserves omitted enriched and academic values, explicit clears remain explicit',()=>{
 const form=new FormData();form.set('grade','G9');const result=studentUpdateInput(studentRecord,form,studentRecord.householdId);
 assert.equal(result.grade,'G9');for(const field of ['studentNumber','currentClass','personalityMarkdown','learningExpectationsMarkdown','strengthsMarkdown','supportNeedsMarkdown','interests','preferredLearningStyle','academicYear','status'])assert.deepEqual(result[field],studentRecord[field]);
 assert.equal(result.expectedUpdatedAt,studentRecord.updatedAt);assert.equal(result.birthDate,studentRecord.birthDate);
 form.set('interests','');form.set('birthDate','');assert.deepEqual(studentUpdateInput(studentRecord,form,'').interests,[]);assert.equal(studentUpdateInput(studentRecord,form,'').birthDate,null);
});
test('record focus preserves directory query; return context rejects external and unrelated destinations',()=>{
 const url=new URL(recordFocusHref('/households',studentRecord.id,'tab=students&q=Example&sort=name'),'https://example.test');assert.equal(url.searchParams.get('q'),'Example');assert.equal(url.searchParams.get('tab'),'students');assert.equal(url.searchParams.get('focus'),studentRecord.id);
 assert.equal(safeRecordReturn('/students?focus=synthetic'),'/students?focus=synthetic');assert.equal(safeRecordReturn('/households?tab=families'),'/households?tab=families');
 for(const href of ['https://example.test','//example.test','/admin','javascript:alert(1)'])assert.equal(safeRecordReturn(href),null);
});
test('Student focus is a workspace; Family panel is a summary, not a nested record navigation',async()=>{
 const ui=await source('components/v200-workspaces.tsx'),student=ui.slice(ui.indexOf('export function StudentsWorkspace'),ui.indexOf('export function HouseholdsWorkspace'));
 assert.match(student,/data-testid="student-workspace"/);assert.match(student,/items=\{studentWorkspaceTabs\}/);assert.doesNotMatch(student,/<CustomerOperationsPanel/);assert.doesNotMatch(student,/detail && <AccessibleDrawer/);
 const summary=await source('components/student-record-context.tsx');assert.match(summary,/member\.role\.toLowerCase/);assert.doesNotMatch(summary,/PARENT.*FATHER|role.*legalAuthority/);assert.match(summary,/tab=families&focus/);
});
test('Journey composes canonical filtered reads and direct owning links without lifecycle mutations',async()=>{
 const ui=await source('components/student-record-context.tsx');for(const path of ['/api/applications','/api/student-success','/applications?focus=','/student-success?focus='])assert.ok(ui.includes(path));assert.match(ui,/StudentEnrollmentsSection/);assert.match(ui,/householdParticipationHelp/);assert.doesNotMatch(ui,/method:\s*["'](?:POST|PATCH|DELETE)/);
});
test('Account owns a single RecordHeader and retains canonical contextual editors and bilingual activity',async()=>{
 const account=await source('components/customer-360-page.tsx'),panel=await source('components/customer-operations-panel.tsx');assert.equal((account.match(/<RecordHeader /g)||[]).length,1);assert.doesNotMatch(account,/<h1>/);assert.match(panel,/!account&&!contentTab&&<header/);
 for(const name of ['OrganizationContractEditor','CrmRecordEditor','ProductCatalogAction','PipelinePage','EducationBusinessWorkspace'])assert.ok(panel.includes(name));
 for(const key of ['summaryZh','summaryEn','nextStepZh','nextStepEn'])assert.match(account,new RegExp('name="'+key+'"[^>]*required'));
 assert.match(panel,/accountWorkspaceTabs/);assert.match(panel,/canManage&&canManageContracts/);assert.match(panel,/onSaved/);
});
test('minimum create keeps mandatory identity/classification and duplicate review; enrichment defaults are canonical',async()=>{
 const ui=await source('components/module-page.tsx'),student=await source('components/v200-workspaces.tsx');assert.match(ui,/ux-enrichment/);assert.match(ui,/name="city" required/);assert.match(ui,/name="organizationType" required/);assert.match(ui,/!duplicateChecked \|\| duplicates.length > 0/);assert.match(ui,/modules.contactMethodRequired/);
 assert.match(student,/operation: "createStudent", personId: person/);assert.match(student,/preferredLearningStyle.*UNSPECIFIED/);assert.match(student,/studentUpdateInput\(detail,form,household\)/);assert.match(student,/setEditing\(false\);const refreshed=await openDetail\(detail,false\);setToast/);
});
test('new terminology has identical locale coverage and stays public-safe',()=>{
 assert.deepEqual(Object.keys(recordWorkspaceZh).sort(),Object.keys(recordWorkspaceEn).sort());for(const messages of [recordWorkspaceZh,recordWorkspaceEn])for(const value of Object.values(messages))assert.doesNotMatch(value,/undefined|\[object Object\]/);
});
test('server presentation isolates same-route focus records without changing legacy route semantics',async()=>{
 for(const path of ['app/(crm)/students/page.tsx','app/(crm)/households/page.tsx'])assert.match(await source(path),/key=\{focus\?\?"directory"\}/);
 assert.match(await source('app/(crm)/households/page.tsx'),/tab!=="families"&&\(!focus\|\|tab==="students"\)/);
});
test('related context uses existing canonical reads, keeps currency and never replaces a Student identity',async()=>{
 const account=await source('components/account-opportunity-summary.tsx'),family=await source('components/household-record-context.tsx');
 assert.match(account,/api\/organizations\/\$\{organizationId\}\/commercial/);assert.match(account,/String\(row.currency\)/);assert.match(account,/formatFinanceAmount\(String\(row.amount\),locale\)/);assert.doesNotMatch(account,/\.reduce\(|method:\s*["'](?:POST|PATCH|DELETE)/);
 assert.match(family,/resource:"studentDetail",id/);assert.match(family,/result.item.id!==id/);assert.match(family,/query.data.item.academicYear/);assert.doesNotMatch(family,/<StudentsWorkspace|<StudentEnrollmentsSection/);
});
