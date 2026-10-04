set search_path=public,extensions;

-- Forward report correction: empty Draft/Cancelled settlement headers count as zero-amount batches.
-- 101 raw bytes remain frozen. Product filters still require a matching ledger line.
create or replace function public.channel_analytics(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare
 ws uuid:=public.current_workspace_id();tz text;today date;date_from date;date_to date;
 lower_bound timestamptz;upper_bound timestamptz;org_id uuid;owner uuid;prod uuid;cohort uuid;
 tier text;filter_stage text;page_number integer;sort_key text;result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or public.current_crm_role() not in
 ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'channel_forbidden';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k
 where k not in ('from','to','organization','owner','product','cohort','tier','stage','page','sort')) then raise exception 'channel_analytics_input_invalid';end if;
 select business_timezone into tz from public.workspaces where id=ws;
 today:=(current_timestamp at time zone tz)::date;
 date_from:=coalesce((p_filters->>'from')::date,today-89);date_to:=coalesce((p_filters->>'to')::date,today);
 if date_from>date_to or date_to-date_from>3660 then raise exception 'channel_analytics_input_invalid';end if;
 lower_bound:=date_from::timestamp at time zone tz;upper_bound:=(date_to+1)::timestamp at time zone tz;
 org_id:=(p_filters->>'organization')::uuid;owner:=(p_filters->>'owner')::uuid;
 prod:=(p_filters->>'product')::uuid;cohort:=(p_filters->>'cohort')::uuid;
 tier:=p_filters->>'tier';filter_stage:=p_filters->>'stage';page_number:=coalesce((p_filters->>'page')::integer,1);sort_key:=coalesce(p_filters->>'sort','name');
 if page_number not between 1 and 100000 or sort_key not in ('name','primary','active','tier') or
 (tier is not null and tier not in ('S','A','B','C','D','UNKNOWN')) then raise exception 'channel_analytics_input_invalid';end if;
 if org_id is not null and not exists(select 1 from public.organizations where workspace_id=ws and id=org_id
 and public.customer_subject_access('ORGANIZATION',id,false)) then raise exception 'channel_forbidden';end if;
 if cohort is not null and not exists(select 1 from public.product_cohorts where workspace_id=ws and id=cohort and (prod is null or product_id=prod)) then raise exception 'channel_analytics_input_invalid';end if;

 with
 opp as materialized (select * from public.opportunities where workspace_id=ws and (prod is null or product_id=prod) and (cohort is null or cohort_id=cohort)
 and (primary_contact_id is null or public.customer_subject_access('CONTACT',primary_contact_id,false))),
 evt as materialized (select * from public.education_outreach_events where workspace_id=ws and (prod is null or product_id=prod) and (cohort is null or cohort_id=cohort)),
 attributed as materialized (
 select distinct a.source_organization_id organization_id,e.id enrollment_id,e.status,e.created_at,a.attribution_type,a.source_event_id
 from public.enrollment_attributions a join public.student_enrollments e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id
 join public.product_cohorts c on c.id=e.cohort_id and c.workspace_id=e.workspace_id
 where a.workspace_id=ws and a.source_organization_id is not null and (prod is null or c.product_id=prod) and (cohort is null or c.id=cohort)),
 ledger as materialized (
 select a.*,exists(select 1 from public.commission_settlement_lines l where l.workspace_id=ws and l.accrual_id=a.id and l.reserved) reserved
 from public.commission_accruals a left join public.student_enrollments e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id
 left join public.product_cohorts c on c.id=e.cohort_id and c.workspace_id=e.workspace_id
 where a.workspace_id=ws and public.channel_commercial_access(a.organization_id,false)
 and (prod is null or c.product_id=prod) and (cohort is null or c.id=cohort)),
 accounts as materialized (
 select o.id,o.name_zh,o.name_en,o.owner_id,p.commercial_tier,p.partnership_potential_score,p.partnership_stage
 from public.organizations o left join public.organization_business_profiles p on p.id=o.id and p.workspace_id=o.workspace_id
 where o.workspace_id=ws and o.archived_at is null and public.customer_subject_access('ORGANIZATION',o.id,false)
 and (coalesce(p.organization_type,o.organization_type) in ('SCHOOL','PARTNER') or p.roles&&array['SCHOOL_ENTRY','REFERRAL_PARTNER','TOUR_PARTNER']::text[])
 and (org_id is null or o.id=org_id) and (owner is null or o.owner_id=owner)
 and (tier is null or coalesce(p.commercial_tier,'UNKNOWN')=tier) and (filter_stage is null or p.partnership_stage=filter_stage)
 and ((prod is null and cohort is null) or exists(select 1 from opp where organization_id=o.id) or exists(select 1 from evt where organization_id=o.id)
 or exists(select 1 from attributed where organization_id=o.id) or exists(select 1 from ledger where organization_id=o.id))),
 contacts as materialized (
 select c.organization_id,count(*) filter(where c.decision_role='DECISION_MAKER') decision_makers,
 count(*) filter(where i.key_contact_status='KEY') key_contacts,count(*) filter(where i.decision_power_score is not null) assessed
 from public.organization_commercial_contact_records c left join public.organization_contact_intelligence_records i on i.contact_id=c.id and i.workspace_id=c.workspace_id
 where c.workspace_id=ws group by c.organization_id),
 leads as materialized (select l.organization_id,count(*) filter(where status in ('NEW','QUALIFYING','QUALIFIED')) open,
 count(*) filter(where status in ('NEW','QUALIFYING','QUALIFIED') and owner_id is not null) claimed,
 count(*) filter(where status in ('NEW','QUALIFYING','QUALIFIED') and owner_id=app_auth.current_user_id()) my_open,
 count(*) filter(where status in ('NEW','QUALIFYING','QUALIFIED') and pool_visibility='WORKSPACE_PUBLIC' and owner_id is null and subject_type='SCHOOL') available
 from public.leads l where workspace_id=ws and subject_type='SCHOOL' group by l.organization_id),
 assignments as materialized (
 select l.organization_id,count(*) filter(where h.event_type='CLAIMED') claims,count(*) filter(where h.event_type='RELEASED') releases,count(*) filter(where h.event_type='REASSIGNED') reassignments
 from public.lead_assignment_history h join public.leads l on l.id=h.lead_id and l.workspace_id=h.workspace_id
 where h.workspace_id=ws and l.subject_type='SCHOOL' and h.changed_at>=lower_bound and h.changed_at<upper_bound group by l.organization_id),
 stages as materialized (select organization_id,count(*) changes from public.organization_channel_stage_history
 where workspace_id=ws and from_stage is not null and changed_at>=lower_bound and changed_at<upper_bound group by organization_id),
 opportunities as materialized (select organization_id,count(*) filter(where stage not in ('WON','LOST')) open,
 count(*) filter(where stage='WON' and closed_at>=lower_bound and closed_at<upper_bound) won,
 count(*) filter(where stage='LOST' and closed_at>=lower_bound and closed_at<upper_bound) lost from opp group by organization_id),
 events as materialized (select organization_id,count(*) filter(where status='CONFIRMED' and starts_on>=today) upcoming,
 count(*) filter(where status='COMPLETED' and starts_on between date_from and date_to) held,
 count(*) filter(where status='CANCELLED' and starts_on between date_from and date_to) cancelled from evt group by organization_id),
 enrollments as materialized (select organization_id,count(distinct enrollment_id) filter(where attribution_type='PRIMARY') primary_count,
 count(distinct enrollment_id) filter(where attribution_type='ASSIST') assist_count,count(distinct enrollment_id) distinct_count,
 count(distinct enrollment_id) filter(where status='ACTIVE') active,
 count(distinct enrollment_id) filter(where attribution_type='PRIMARY' and created_at>=lower_bound and created_at<upper_bound) new_primary,
 count(distinct enrollment_id) filter(where attribution_type='ASSIST' and created_at>=lower_bound and created_at<upper_bound) new_assist,
 count(distinct a.enrollment_id) filter(where a.created_at>=lower_bound and a.created_at<upper_bound and exists(select 1 from evt where id=a.source_event_id)) event_attributed
 from attributed a group by organization_id),
 commission as materialized (
 select organization_id,currency,coalesce(sum(commission_amount),0)::text net,coalesce(sum(commission_amount) filter(where not reserved),0)::text open,
 coalesce(sum(commission_amount) filter(where entry_type='EARNED' and accrued_at>=lower_bound and accrued_at<upper_bound),0)::text earned,
 coalesce(sum(commission_amount) filter(where entry_type='REVERSAL' and accrued_at>=lower_bound and accrued_at<upper_bound),0)::text reversals,
 coalesce(sum(commission_amount) filter(where accrued_at>=lower_bound and accrued_at<upper_bound),0)::text period_net from ledger group by organization_id,currency),
 settlements as materialized (
 select s.organization_id,s.currency,s.status,count(distinct s.id) count,
 coalesce(sum(a.commission_amount),0)::text amount,
 coalesce(sum(a.commission_amount) filter(where s.status='APPROVED' and s.approved_at>=lower_bound and s.approved_at<upper_bound),0)::text approved_in_period,
 coalesce(sum(a.commission_amount) filter(where s.status='PAID' and s.paid_at>=lower_bound and s.paid_at<upper_bound),0)::text paid_in_period,
 count(distinct s.id) filter(where s.status='PAID' and s.paid_at>=lower_bound and s.paid_at<upper_bound) paid_count_in_period
 from public.commission_settlements s left join public.commission_settlement_lines l on l.settlement_id=s.id and l.workspace_id=s.workspace_id
 left join ledger a on a.id=l.accrual_id and a.workspace_id=l.workspace_id where s.workspace_id=ws and ((prod is null and cohort is null) or a.id is not null) group by s.organization_id,s.currency,s.status),
 quality as materialized (select q.entity_id organization_id,q.severity,count(*) count from public.data_quality_issues q
 join accounts a on a.id=q.entity_id where q.workspace_id=ws and q.entity_type='ORGANIZATION' and q.status in ('OPEN','ASSIGNED')
 -- Cached contact/enrollment-related findings are excluded: their source visibility may have changed.
 and q.rule_key in ('HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION','CHANNEL_ACCOUNT_WITHOUT_OWNER',
 'ACTIVE_CHANNEL_WITHOUT_AGREEMENT','ACTIVE_AGREEMENT_WITHOUT_RULE','APPROVED_SETTLEMENT_NOT_PAID')
 and (q.rule_key not like '%AGREEMENT%' and q.rule_key not like '%SETTLEMENT%' or public.channel_commercial_access(a.id,false)) group by q.entity_id,q.severity),
 rows as materialized (
 select a.*,coalesce(c.key_contacts,0) key_contact_count,coalesce(c.decision_makers,0) decision_maker_count,
 coalesce(e.primary_count,0) primary_count,coalesce(e.active,0) active,
 jsonb_build_object('organizationId',a.id,'nameZh',a.name_zh,'nameEn',a.name_en,'commercialTier',a.commercial_tier,'partnershipPotential',a.partnership_potential_score,'partnershipStage',a.partnership_stage,
 'snapshot',jsonb_build_object('keyContacts',coalesce(c.key_contacts,0),'decisionMakers',coalesce(c.decision_makers,0),'assessedContacts',coalesce(c.assessed,0),
 'openLeads',coalesce(l.open,0),'claimedLeads',coalesce(l.claimed,0),'myOpenLeads',coalesce(l.my_open,0),'availablePublicLeads',coalesce(l.available,0),
 'openOpportunities',coalesce(o.open,0),'upcomingEvents',coalesce(v.upcoming,0),'primaryContributions',coalesce(e.primary_count,0),'assistContributions',coalesce(e.assist_count,0),
 'distinctAttributedEnrollments',coalesce(e.distinct_count,0),'activeEnrollments',coalesce(e.active,0)),
 'period',jsonb_build_object('claims',coalesce(h.claims,0),'releases',coalesce(h.releases,0),'reassignments',coalesce(h.reassignments,0),'stageChanges',coalesce(g.changes,0),
 'opportunitiesWon',coalesce(o.won,0),'opportunitiesLost',coalesce(o.lost,0),'eventsHeld',coalesce(v.held,0),'eventsCancelled',coalesce(v.cancelled,0),
 'newPrimaryContributions',coalesce(e.new_primary,0),'newAssistContributions',coalesce(e.new_assist,0),'eventAttributedEnrollments',coalesce(e.event_attributed,0)),
 'enrollmentStatuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(distinct enrollment_id) n from attributed where organization_id=a.id group by status)x),'{}'::jsonb),
 'leadStatuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.leads where workspace_id=ws and subject_type='SCHOOL' and organization_id=a.id group by status)x),'{}'::jsonb),
 'commissionByCurrency',coalesce((select jsonb_agg(to_jsonb(m)-'organization_id' order by currency) from commission m where m.organization_id=a.id),'[]'::jsonb),
 'settlementByCurrency',coalesce((select jsonb_agg(to_jsonb(s)-'organization_id' order by currency,status) from settlements s where s.organization_id=a.id),'[]'::jsonb),
 'quality',coalesce((select jsonb_object_agg(severity,count) from quality q where q.organization_id=a.id),'{}'::jsonb),
 'moneyVisible',public.channel_commercial_access(a.id,false)) item
 from accounts a left join contacts c on c.organization_id=a.id left join leads l on l.organization_id=a.id
 left join assignments h on h.organization_id=a.id left join stages g on g.organization_id=a.id left join opportunities o on o.organization_id=a.id
 left join events v on v.organization_id=a.id left join enrollments e on e.organization_id=a.id),
 currency_totals as (select currency,sum(net::numeric)::text net,sum(open::numeric)::text open,sum(earned::numeric)::text earned,sum(reversals::numeric)::text reversals,sum(period_net::numeric)::text period_net
 from commission m join accounts a on a.id=m.organization_id group by currency),
 settlement_totals as (select currency,status,sum(count)::integer count,sum(amount::numeric)::text amount,sum(approved_in_period::numeric)::text approved_in_period,
 sum(paid_in_period::numeric)::text paid_in_period,sum(paid_count_in_period)::integer paid_count_in_period from settlements s join accounts a on a.id=s.organization_id group by currency,status)
 select jsonb_build_object('filters',p_filters,'currencies',coalesce((select jsonb_agg(currency order by currency) from (select currency from currency_totals union select currency from settlement_totals)x),'[]'::jsonb),
 'permissions',jsonb_build_object('moneyVisible',public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')),
 'snapshot',jsonb_build_object('asOf',current_timestamp,'visibleAccounts',(select count(*) from rows),'withKeyContact',(select count(*) from rows where key_contact_count>0),
 'withoutKeyContact',(select count(*) from rows where key_contact_count=0),'withDecisionMaker',(select count(*) from rows where decision_maker_count>0),
 'withoutDecisionMaker',(select count(*) from rows where decision_maker_count=0),'withActiveOpportunity',(select count(*) from rows where (item->'snapshot'->>'openOpportunities')::integer>0),
 'withoutActiveOpportunity',(select count(*) from rows where (item->'snapshot'->>'openOpportunities')::integer=0),
 'byTier',coalesce((select jsonb_object_agg(t,n) from (select coalesce(commercial_tier,'UNKNOWN') t,count(*) n from rows group by 1)x),'{}'::jsonb),
 'byStage',coalesce((select jsonb_object_agg(t,n) from (select coalesce(partnership_stage,'UNKNOWN') t,count(*) n from rows group by 1)x),'{}'::jsonb),
 'activeAttributedEnrollments',(select count(distinct enrollment_id) from attributed t join accounts a on a.id=t.organization_id where t.status='ACTIVE')),
 'period',jsonb_build_object('from',date_from,'to',date_to,'timezone',tz),
 'totals',coalesce((select jsonb_object_agg(key,value) from (
 select key,sum(value::numeric) value from rows r cross join lateral jsonb_each_text(r.item->'period') group by key)x),'{}'::jsonb)||jsonb_build_object(
 'eventAttributedEnrollments',(select count(distinct enrollment_id) from attributed t join accounts a on a.id=t.organization_id
 where t.created_at>=lower_bound and t.created_at<upper_bound and exists(select 1 from evt where id=t.source_event_id))),
 'snapshotTotals',coalesce((select jsonb_object_agg(key,value) from (
 select key,sum(value::numeric) value from rows r cross join lateral jsonb_each_text(r.item->'snapshot') group by key)x),'{}'::jsonb)||jsonb_build_object(
 'distinctAttributedEnrollments',(select count(distinct enrollment_id) from attributed t join accounts a on a.id=t.organization_id),
 'activeEnrollments',(select count(distinct enrollment_id) from attributed t join accounts a on a.id=t.organization_id where t.status='ACTIVE')),
 'commissionByCurrency',coalesce((select jsonb_agg(to_jsonb(c) order by currency) from currency_totals c),'[]'::jsonb),
 'settlementByCurrency',coalesce((select jsonb_agg(to_jsonb(s) order by currency,status) from settlement_totals s),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(item) from (select item from rows order by
 case when sort_key='primary' then primary_count end desc,case when sort_key='active' then active end desc,
 case when sort_key='tier' then commercial_tier end asc nulls last,name_en,name_zh,id limit 50 offset (page_number-1)*50)x),'[]'::jsonb),
 'page',page_number,'pageSize',50,'total',(select count(*) from rows)) into result;
 return result;
end $$;
revoke all on function public.channel_analytics(jsonb) from public;
grant execute on function public.channel_analytics(jsonb) to crm_app;
