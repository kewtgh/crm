set search_path=public,app_auth,extensions;
alter table public.data_quality_issues add column revision integer not null default 1 check(revision>0);
alter table public.data_quality_rule_configs add column revision integer not null default 1 check(revision>0);
create function public.advance_quality_revision() returns trigger language plpgsql as $$begin new.revision:=old.revision+1;return new;end$$;
create trigger quality_issue_revision before update on public.data_quality_issues for each row execute function public.advance_quality_revision();
create trigger quality_rule_revision before update on public.data_quality_rule_configs for each row execute function public.advance_quality_revision();

create function public.execute_quality_command(command jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare actor uuid:=app_auth.current_user_id();ws uuid:=public.current_workspace_id();op text:=command->>'operation';r public.mutation_receipts;fingerprint text;result jsonb;issue public.data_quality_issues;rule public.data_quality_rule_configs;expected integer;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized';end if;
 if jsonb_typeof(command) is distinct from 'object' or op is null or op not in ('run','resolve','assign','configure')
  or p_request_key is null or p_request_key<>trim(p_request_key) or length(p_request_key) not between 8 and 160 then raise exception 'quality_input_invalid';end if;
 if op<>'run' then expected:=(command->>'expectedRevision')::integer;if expected is null or expected<1 then raise exception 'quality_input_invalid';end if;end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':quality-state',0));
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':quality-command:'||p_request_key,0));
 fingerprint:=encode(digest(command::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by is distinct from actor or r.operation<>'QUALITY_COMMAND' or r.result->>'request_hash' is distinct from fingerprint then raise exception 'quality_request_conflict';end if;
  return r.result->'item';
 end if;
 if op='run' then result:=to_jsonb(public.run_data_quality_rules());
 elsif op='configure' then
  if length(coalesce(command->>'ruleKey','')) not between 2 and 100 or jsonb_typeof(command->'enabled') is distinct from 'boolean' or coalesce(command->>'severity','') not in ('HIGH','MEDIUM','LOW') then raise exception 'quality_input_invalid';end if;
  select * into rule from public.data_quality_rule_configs where workspace_id=ws and rule_key=upper(trim(command->>'ruleKey')) for update;
  if not found or rule.revision<>expected then raise exception 'quality_version_conflict';end if;
  result:=to_jsonb(public.configure_data_quality_rule(command->>'ruleKey',(command->>'enabled')::boolean,command->>'severity'));
 else
  select * into issue from public.data_quality_issues where workspace_id=ws and id=(command->>'id')::uuid for update;
  if not found or issue.revision<>expected or issue.status not in ('OPEN','ASSIGNED') then raise exception 'quality_version_conflict';end if;
  if op='assign' then result:=to_jsonb(public.assign_data_quality_issue(issue.id,actor));
  else
   if length(trim(coalesce(command->>'resolution',''))) not between 2 and 500 or jsonb_typeof(command->'dismiss') is distinct from 'boolean' then raise exception 'quality_input_invalid';end if;
   result:=to_jsonb(public.resolve_data_quality_issue(issue.id,command->>'resolution',(command->>'dismiss')::boolean));
  end if;
 end if;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'QUALITY_COMMAND',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end$$;
revoke all on function public.execute_quality_command(jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.execute_quality_command(jsonb,text) to crm_app;
revoke execute on function public.run_data_quality_rules(),public.resolve_data_quality_issue(uuid,text,boolean),public.assign_data_quality_issue(uuid,uuid),public.configure_data_quality_rule(text,boolean,text) from crm_app;
revoke update on public.data_quality_issues,public.data_quality_rule_configs from crm_app;
