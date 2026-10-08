import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

export async function verifyStaffRolesAndPerformance({admin,execute,create,workspace,otherWorkspace,superId,adminId,team}) {
 const {authenticateAccount}=await import("../../lib/auth/accounts.ts");
 const {decryptInvitationCredential}=await import("../../lib/invitation-credential-crypto.mjs");
 const {getStaffUser}=await import("../../lib/admin-users-repository.ts");
 const q=async(sql,args=[])=>(await admin.query(sql,args)).rows[0];
 await admin.query("select set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false),set_config('app.aal','aal2',false)",[workspace,superId]);
 const member=async user=>(await q("select id from public.sales_team_members where auth_user_id=$1 and workspace_id=$2",[user.id,workspace])).id;
 const dates=await q("select current_date::text today,(current_date+1)::text tomorrow,date_trunc('quarter',current_date)::date::text start,(date_trunc('quarter',current_date)+interval '3 months')::date::text finish");
 const configure=(user,revision,eligible,extra={},who=superId,key=randomUUID(),aal="aal2")=>execute(who,"select public.staff_profile_command($1,$2,$3,$4,$5,$6,$7,$8) item",[user.id,revision,extra.primary??"SALES",extra.additional??[],eligible,extra.date??dates.today,extra.reason??"Fictional governed scope",key],aal);
 const finance=await create("finance.specialist",{role:"FINANCE_SPECIALIST",teamId:null});
 const financeManager=await create("finance.manager",{role:"FINANCE_MANAGER",teamId:null});
 const operations=await create("operations.staff",{role:"OPERATIONS_SPECIALIST",teamId:null});
 const academic=await create("academic.staff",{role:"ACADEMIC_SPECIALIST",teamId:null});
 const customer=await create("customer.success",{role:"CUSTOMER_SUCCESS_SPECIALIST",teamId:null});
 for(const staff of [finance,financeManager,operations,academic,customer]){
  const outbox=await q("select payload from public.notification_outbox where recipient_id=$1",[staff.id]);
  const temporary=decryptInvitationCredential(outbox.payload.encryptedTemporaryPassword);
  const identity=await authenticateAccount(staff.username,temporary);
  assert.equal(identity?.id,staff.id);assert.equal(identity?.role,staff.role);assert.equal(identity.mustChangePassword,true);
  const record=await getStaffUser(staff.id);assert.equal(record.businessProfile.salesEligible,false);assert.equal(record.teams.length,0);
 }
 for(const staff of [operations,academic]){
  const student=await execute(staff.id,"select public.create_education_identity('STUDENT',$1,$2) item",[{nameZh:"示例学生",nameEn:"Fictional learner",grade:"10",academicYear:"2026-2027"},randomUUID()]);assert.ok(student.id);
  assert.equal(Number(await execute(staff.id,"select count(*) item from public.students where id=$1",[student.id])),1);
  await assert.rejects(execute(customer.id,"select public.create_education_identity('STUDENT',$1,$2) item",[{nameEn:"Unauthorized learner",grade:"10",academicYear:"2026-2027"},randomUUID()]),e=>e.message==="PERMISSION_DENIED");
  await assert.rejects(execute(staff.id,"select public.save_customer_record('ORGANIZATIONS',$1,null,$2) item",[randomUUID(),{nameZh:"Denied",nameEn:"Denied"}]),e=>e.message==="PERMISSION_DENIED");
 }
 const seller=await create("qualified.sales");const sellerMember=await member(seller);
 assert.equal((await getStaffUser(seller.id)).businessProfile.salesEligible,false);
 await assert.rejects(configure(finance,1,true,{primary:"FINANCE"}),e=>e.message==="SALES_ELIGIBILITY_REQUIRES_TEAM");
 await assert.rejects(configure(seller,1,true,{},superId,randomUUID(),"aal1"),e=>e.message==="MFA_REQUIRED");
 await assert.rejects(configure(seller,1,true,{},operations.id),e=>e.message==="ROLE_ASSIGNMENT_FORBIDDEN");
 const key=randomUUID(),saved=await configure(seller,1,true,{},superId,key);assert.equal(saved.salesEligible,true);assert.deepEqual(await configure(seller,1,true,{},superId,key),saved);
 await assert.rejects(configure(seller,1,false,{},superId,key),e=>e.message==="PAYLOAD_REUSE");
 await assert.rejects(configure(seller,1,false),e=>e.message==="STALE_TARGET");
 await assert.rejects(configure(seller,2,false,{date:"2000-01-01"}),e=>e.message==="INVALID_INPUT");
 assert.equal((await execute(superId,"select to_jsonb(r) item from public.staff_sales_roster() r")).id,sellerMember);
 const changeSql="select public.change_staff_role($1,$2,$3,$4) item";
 await assert.rejects(execute(adminId,changeSql,[finance.id,"ADMIN",finance.role,randomUUID()]),e=>e.message==="ROLE_ASSIGNMENT_FORBIDDEN");
 await assert.rejects(execute(superId,changeSql,[finance.id,"SALES_SPECIALIST",finance.role,randomUUID()]),e=>e.message==="TEAM_NOT_FOUND");
 const changeKey=randomUUID();const changed=await execute(superId,changeSql,[finance.id,"OPERATIONS_MANAGER",finance.role,changeKey]);assert.equal(changed.role,"OPERATIONS_MANAGER");assert.deepEqual(await execute(superId,changeSql,[finance.id,"OPERATIONS_MANAGER",finance.role,changeKey]),changed);
 // Self-managed qualification changes do not grant system roles or Revenue authority.
 for(const [id,who] of [[superId,superId],[adminId,adminId]]){
  await admin.query("insert into public.sales_team_members(workspace_id,auth_user_id,name_zh,name_en,role,team) select $1,$2,'示例管理员','Fictional Admin',role,'Administration' from public.workspace_memberships where workspace_id=$1 and user_id=$2 on conflict do nothing",[workspace,id]);
  const m=(await q("select id from public.sales_team_members where auth_user_id=$1 and workspace_id=$2",[id,workspace])).id;
  await admin.query("insert into public.sales_team_memberships(workspace_id,member_id,team_id,status,requested_by,reviewed_by) values($1,$2,$3,'ACTIVE',$4,$4) on conflict do nothing",[workspace,m,team,superId]);
  await configure({id},1,false,{primary:"ADMINISTRATION"},who);
  const own=await configure({id},2,true,{primary:"MANAGEMENT",additional:["SALES"]},who);assert.equal(own.salesEligible,true);
  await configure({id},3,false,{primary:"ADMINISTRATION"},who);
 }
 await assert.rejects(configure({id:superId},4,false,{primary:"ADMINISTRATION"},adminId),e=>e.message==="ROLE_ASSIGNMENT_FORBIDDEN");
 console.log("PASS non-sales account creation/login, no fake sales team, explicit eligibility, AAL2/admin roles, team enforcement and exact receipt replay.");

 const org=(await q("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'示例客户','Fictional Customer',$2,$2) returning id",[workspace,superId])).id;
 const contract=(await q("insert into public.contracts(workspace_id,contract_number,organization_id,start_date,end_date,contract_value,owner_id,created_by) values($1,'FICTIONAL-PERFORMANCE',$2,current_date,current_date+365,1000,$3,$3) returning id",[workspace,org,superId])).id;
 const schedule=(await q("insert into public.receivable_schedules(workspace_id,contract_id,installment_number,due_date,amount,created_by) values($1,$2,1,current_date,1000,$3) returning id",[workspace,contract,superId])).id;
 const payment=(await q("insert into public.payments(workspace_id,contract_id,receivable_schedule_id,amount,currency,status,paid_at,reference) values($1,$2,$3,700,'CNY','CONFIRMED',now(),'FICTIONAL-SETTLEMENT') returning id",[workspace,contract,schedule])).id;
 await admin.query("select public.refresh_receivable($1)",[schedule]);
 await admin.query("insert into public.performance_contributions(workspace_id,payment_id,contributor_member_id,attribution_type,amount,created_by) values($1,$2,$3,'DIRECT',400,$4)",[workspace,payment,sellerMember,superId]);
 await admin.query("insert into public.performance_contributions(workspace_id,payment_id,contributor_member_id,attribution_type,amount,created_by) values($1,$2,$3,'ASSISTED',100,$4)",[workspace,payment,await member(financeManager),superId]);
 assert.equal(Number(await execute(financeManager.id,"select count(*) item from public.payments where id=$1",[payment])),1);
 assert.equal(Number(await execute(operations.id,"select count(*) item from public.payments where id=$1",[payment])),0);
 await assert.rejects(execute(finance.id,"select to_jsonb(public.record_payment($1,$2,10,'CNY','Fictional denied',now())) item",[contract,schedule]),e=>/finance_role_required|not_authorized|not_authenticated/.test(e.message));
 const financePayment=await execute(financeManager.id,"select to_jsonb(public.record_payment($1,$2,10,'CNY','Fictional finance manager settlement',now())) item",[contract,schedule]);assert.equal(Number(financePayment.amount),10);
 const target=(await q("insert into public.performance_targets(workspace_id,manager_id,period_start,period_end,currency,target_amount,status,created_by) values($1,$2,$3,$4::date-1,'CNY',1000,'DRAFT',$2) returning id",[workspace,superId,dates.start,dates.finish])).id;
 await admin.query("insert into public.performance_allocations(target_id,contributor_member_id,contributor_role,attribution_type,allocated_amount,created_by) values($1,$2,'SALES_SPECIALIST','DIRECT',1000,$3)",[target,sellerMember,superId]);
 await admin.query("update public.performance_targets set status='ACTIVE' where id=$1",[target]);
 const financialSnapshot=async()=>({payments:(await q("select jsonb_agg(to_jsonb(p) order by id) v from public.payments p")).v,contributions:(await q("select jsonb_agg(to_jsonb(p) order by id) v from public.performance_contributions p")).v,targets:(await q("select jsonb_agg(to_jsonb(p) order by id) v from public.performance_targets p")).v,facts:(await q("select count(*) n from public.recognized_revenue_facts")).n,commission:(await q("select count(*) n from public.commission_accruals")).n,cash:(await q("select count(*) n from public.cash_applications")).n});
 const baseline=await financialSnapshot();
 const report=()=>execute(superId,"select public.sales_performance_report_v220('quarter',null,'CNY') item");
 let view=await report();assert.equal(Number(view.actual),400);assert.equal(Number(view.unscopedActual),100);assert.equal(view.members.length,1);assert.equal(Number(view.target),1000);
 const exported=async()=>(await admin.query("select * from public.performance_export_rows_v220($1,$2,$3)",[workspace,dates.start,dates.finish])).rows;
 let rows=await exported();assert.equal(rows.length,1);assert.equal(Number(rows[0].confirmed_performance),Number(view.actual));assert.equal(Number(rows[0].allocated_target),Number(view.target));
 await configure(seller,2,false);
 assert.equal((await getStaffUser(seller.id)).businessProfile.salesEligible,false);
 view=await report();assert.equal(Number(view.actual),400);assert.equal(view.members.length,1,"approved period scope remains visible");assert.equal(Number(view.forecast),0);
 rows=await exported();assert.equal(Number(rows[0].confirmed_performance),400);
 assert.equal(await execute(superId,"select public.staff_reporting_current($1) item",[sellerMember]),false);
 assert.equal(await execute(superId,"select public.staff_reporting_at($1,current_date) item",[sellerMember]),true);
 assert.deepEqual(await financialSnapshot(),baseline);
 await admin.query("update public.performance_targets set status='CLOSED' where id=$1",[target]);
 assert.equal(Number((await report()).actual),400);assert.equal(Number((await exported())[0].allocated_target),1000);
 await assert.rejects(admin.query("update public.staff_sales_eligibility_events set eligible=true where member_id=$1",[sellerMember]),e=>e.message==="STAFF_REPORTING_HISTORY_IMMUTABLE");
 await assert.rejects(admin.query("delete from public.staff_sales_period_scopes where member_id=$1",[sellerMember]),e=>e.message==="STAFF_REPORTING_HISTORY_IMMUTABLE");
 await assert.rejects(execute(operations.id,"select public.sales_performance_report_v220('quarter',null,'CNY') item"),e=>e.message==="not_authenticated");
 for(const [staff,table,edit,allowed] of [[operations,"payments",false,false],[financeManager,"payments",false,true],[academic,"students",true,true],[customer,"students",true,false],[financeManager,"recognized_revenue_facts",true,false]]) assert.equal(await execute(staff.id,"select public.staff_role_table_access($1,$2) item",[table,edit]),allowed);
 await assert.rejects(execute(seller.id,"insert into public.staff_sales_eligibility_events(workspace_id,member_id,eligible,effective_from,reason,approved_by) values($1,$2,true,current_date,'unauthorized',$3)",[workspace,sellerMember,seller.id]),e=>e.code==="42501");
 const foreign=(await q("insert into app_auth.accounts(email,username) values('foreign-staff@example.test','foreign-staff') returning id")).id;
 await admin.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'OPERATIONS_SPECIALIST')",[otherWorkspace,foreign]);
 await assert.rejects(execute(superId,"select public.staff_profile_command($1,1,'OTHER','{}',false,current_date,'Fictional cross-workspace',$2) item",[foreign,randomUUID()]),e=>e.message==="STAFF_USER_NOT_FOUND");
 console.log("PASS report/export parity, unscoped contribution context, approved/closed period retention, current exclusion, immutable history and unchanged company financial facts.");
 // Audit injection must roll back both qualification and receipt.
 const audit=await create("audit.rollback");const before=await getStaffUser(audit.id);
 await admin.query("create function public.v336_fail_audit() returns trigger language plpgsql as $$begin if new.action='STAFF_PROFILE_CHANGE' then raise exception 'FICTIONAL_AUDIT_FAILURE';end if;return new;end $$;create trigger v336_fail_audit before insert on public.audit_events for each row execute function public.v336_fail_audit()");
 const auditKey=randomUUID();await assert.rejects(configure(audit,1,true,{},superId,auditKey),e=>e.message==="FICTIONAL_AUDIT_FAILURE");
 await admin.query("drop trigger v336_fail_audit on public.audit_events;drop function public.v336_fail_audit()");
 assert.deepEqual((await getStaffUser(audit.id)).businessProfile,before.businessProfile);
 assert.equal((await q("select count(*) n from public.mutation_receipts where request_key=$1",[auditKey])).n,"0");
 console.log("PASS profile/eligibility/audit/receipt atomic rollback.");
}
