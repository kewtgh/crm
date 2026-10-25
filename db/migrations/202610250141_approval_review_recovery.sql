set search_path=public,app_auth,extensions;

create function public.approval_review_token(p_request public.approval_requests) returns text
language sql immutable set search_path=public,extensions as $$
 select encode(digest(((to_jsonb(p_request)-array['created_at','updated_at','expires_at','decided_at','executed_at'])||jsonb_build_object(
  'created_at',extract(epoch from p_request.created_at),'updated_at',extract(epoch from p_request.updated_at),
  'expires_at',extract(epoch from p_request.expires_at),'decided_at',extract(epoch from p_request.decided_at),'executed_at',extract(epoch from p_request.executed_at)))::text,'sha256'),'hex');
$$;
revoke all on function public.approval_review_token(public.approval_requests) from public,crm_system,crm_worker;
grant execute on function public.approval_review_token(public.approval_requests) to crm_app;

-- Authorization only: accepted receipt replay must not require a pending status.
create function public.approval_actor_can_decide(p_id uuid) returns boolean
language sql stable security definer set search_path=public,app_auth,extensions as $$
 select exists(select 1 from public.approval_requests a where a.id=p_id and a.workspace_id=public.current_workspace_id()
  and public.is_workspace_member(a.workspace_id) and app_auth.current_user_id() is not null
  and coalesce(app_auth.current_claims()->>'aal','aal1')='aal2'
  and not exists(select 1 from public.refunds refund join public.payments payment on payment.id=refund.payment_id
   where a.request_type='REFUND' and refund.id::text=lower(a.business_object_id) and refund.workspace_id=a.workspace_id and payment.purpose='CUSTODY_RECEIPT'
    and (a.requester_id=app_auth.current_user_id() or not coalesce(public.revenue_has_authority(payment.reporting_entity_id,'CASH_APPLICATION_MANAGER'),false)
     or not exists(select 1 from public.revenue_reporting_profiles profile where profile.workspace_id=a.workspace_id and profile.reporting_entity_id=payment.reporting_entity_id and profile.status='ACTIVE')))
  and (public.current_crm_role() in ('ADMIN','SUPER_ADMIN') or (
   public.current_crm_role() in ('SALES_DIRECTOR','SALES_MANAGER') and a.requester_id<>app_auth.current_user_id() and a.required_role='TEAM_LEAD'
   and exists(select 1 from public.sales_teams t join public.sales_team_members requester on requester.team_id=t.id
    join public.sales_team_members leader on leader.id=t.lead_member_id
    where requester.auth_user_id=a.requester_id and requester.active and leader.auth_user_id=app_auth.current_user_id() and leader.active and t.workspace_id=a.workspace_id))));
$$;
revoke all on function public.approval_actor_can_decide(uuid) from public,crm_system,crm_worker;
grant execute on function public.approval_actor_can_decide(uuid) to crm_app;

create function public.query_approval_workspace(p_query text,p_type text,p_status text,p_scope text,p_execution text,p_page integer,p_page_size integer)
returns jsonb language plpgsql stable security invoker set search_path=public,app_auth,extensions as $$
declare result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'approval_access_denied';end if;
 if p_query is null or length(p_query)>100 or p_type is null or p_type not in ('all','other','CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT','REVENUE_REPORTING_PROFILE','REVENUE_POLICY_VERSION','REVENUE_SERVICE_BINDING','REVENUE_AUTHORITY_ASSIGNMENT','REVENUE_RECOGNITION_CANDIDATE')
  or p_status is null or p_status not in ('all','pending','approved','rejected','cancelled','expired') or p_scope is null or p_scope not in ('all','mine','reviewable')
  or p_execution is null or p_execution not in ('all','NOT_STARTED','SUCCEEDED','FAILED') or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (10,20,50) then raise exception 'approval_input_invalid';end if;
 with visible as materialized (
  select a.*,public.approval_review_token(a) review_token,
   case when a.status='PENDING' and a.expires_at<=now() then 'expired' else lower(a.status) end display_status,
   a.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT')
    and a.status='PENDING' and a.expires_at>now() and public.approval_actor_can_decide(a.id) can_decide
  from public.approval_requests a where a.workspace_id=public.current_workspace_id()
 ), filtered as (
  select * from visible a where
   (trim(p_query)='' or strpos(lower(concat_ws(' ',a.request_number,a.business_object_type,a.business_object_id,a.reason)),lower(trim(p_query)))>0)
   and (p_type='all' or a.request_type=p_type or p_type='other' and a.request_type not in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT','REVENUE_REPORTING_PROFILE','REVENUE_POLICY_VERSION','REVENUE_SERVICE_BINDING','REVENUE_AUTHORITY_ASSIGNMENT','REVENUE_RECOGNITION_CANDIDATE'))
   and (p_status='all' or a.display_status=p_status)
   and (p_scope='all' or p_scope='mine' and a.requester_id=app_auth.current_user_id() or p_scope='reviewable' and a.can_decide)
   and (p_execution='all' or a.execution_status=p_execution)
 ), paged as (select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page::bigint-1)*p_page_size),
 payload as (
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'requesterId',a.requester_id,'requestNumber',a.request_number,'requestType',a.request_type,
   'object',a.business_object_type||' · '||a.business_object_id,'requester',coalesce(nullif(concat_ws(' / ',p.display_name_zh,p.display_name_en),''),left(a.requester_id::text,8)),
   'submitted',a.created_at,'expiresAt',a.expires_at,'level',case a.required_role when 'SUPER_ADMIN' then 'superAdmin' when 'TEAM_LEAD' then 'teamLead' else 'admin' end,
   'reason',a.reason,'status',a.display_status,'executionStatus',a.execution_status,'decisionReason',a.decision_reason,'decidedAt',a.decided_at,'reviewToken',a.review_token,'canDecide',a.can_decide
  ) order by a.created_at desc,a.id desc),'[]'::jsonb) items from paged a left join public.user_profiles p on p.user_id=a.requester_id
 )
 select jsonb_build_object('items',payload.items,'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,'asOf',now(),
  'summary',jsonb_build_object('pending',(select count(*) from visible where display_status='pending'),'approved',(select count(*) from visible where display_status='approved'),
   'rejected',(select count(*) from visible where display_status='rejected'),'cancelled',(select count(*) from visible where display_status='cancelled'),
   'expired',(select count(*) from visible where display_status='expired'),'failedExecution',(select count(*) from visible where execution_status='FAILED'),
   'highPrivilegePending',(select count(*) from visible where display_status='pending' and required_role='SUPER_ADMIN'))) into result from payload;
 return result;
end $$;
revoke all on function public.query_approval_workspace(text,text,text,text,text,integer,integer) from public,crm_system,crm_worker;
grant execute on function public.query_approval_workspace(text,text,text,text,text,integer,integer) to crm_app;

create function public.approval_pending_count() returns jsonb language sql stable security invoker set search_path=public,app_auth as $$
 select jsonb_build_object('count',count(*)) from public.approval_requests
 where workspace_id=public.current_workspace_id() and status='PENDING' and expires_at>now();
$$;
revoke all on function public.approval_pending_count() from public,crm_system,crm_worker;
grant execute on function public.approval_pending_count() to crm_app;

create function public.decide_approval_command(p_id uuid,p_review_token text,p_decision text,p_comment text,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
 ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();a public.approval_requests;
 payment public.payments;receipt public.mutation_receipts;fingerprint text;result jsonb;
begin
 if actor is null or not public.is_workspace_member(ws) or not public.approval_actor_can_decide(p_id) then raise exception 'approval_access_denied';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 if p_id is null or p_review_token is null or p_review_token!~'^[a-f0-9]{64}$' or p_decision is null or p_decision not in ('APPROVED','REJECTED')
  or length(coalesce(p_comment,''))>1000 or p_decision='REJECTED' and nullif(trim(p_comment),'') is null
  or p_request_key is null or length(p_request_key) not between 8 and 120 or p_request_key<>trim(p_request_key) then raise exception 'approval_input_invalid';end if;
 select * into a from public.approval_requests where id=p_id and workspace_id=ws;
 if a.request_type not in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT') then raise exception 'approval_domain_review_required';end if;
 -- The existing custody path acquires entity/finance locks BEFORE the approval row.
 if a.request_type='REFUND' then
  select p.* into payment from public.payments p join public.refunds r on r.payment_id=p.id where r.id=a.business_object_id::uuid and p.workspace_id=ws;
  if payment.purpose='CUSTODY_RECEIPT' then
   perform public.cash_require(payment.reporting_entity_id);
   if a.requester_id=actor then raise exception 'cash_independent_refund_review';end if;
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':approval-decision:'||p_request_key,0));
 select * into a from public.approval_requests where id=p_id and workspace_id=ws for update;
 if not found or not public.approval_actor_can_decide(p_id) then raise exception 'approval_access_denied';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,p_review_token,p_decision,coalesce(trim(p_comment),''))::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'APPROVAL_DECISION' or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'approval_request_conflict';end if;
  return receipt.result->'item';
 end if;
 if public.approval_review_token(a)<>p_review_token then raise exception 'approval_snapshot_conflict';end if;
 if a.status<>'PENDING' or a.expires_at<=now() then raise exception 'approval_not_pending';end if;
 a:=public.decide_approval(p_id,p_decision,p_comment);
 result:=jsonb_build_object('id',a.id,'status',lower(a.status),'executionStatus',a.execution_status,'accepted',true);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id)
  values(ws,actor,'approval_request',a.id::text,'APPROVAL_DECISION_CONFIRMED',jsonb_build_object('status',a.status,'executionStatus',a.execution_status),p_request_key);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'APPROVAL_DECISION',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.decide_approval_command(uuid,text,text,text,text) from public,crm_system,crm_worker;
grant execute on function public.decide_approval_command(uuid,text,text,text,text) to crm_app;
-- Existing specialized revenue RPCs retain decide_approval and their independent guards.
