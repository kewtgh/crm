-- Complete the staged actor FK from 128 without rewriting receipt history.
-- Legacy orphans require controlled review, never guessed actor backfill/deletion.
do $$
begin
 if exists(
  select 1 from public.uploaded_contract_receipts receipt
  left join app_auth.accounts account on account.id=receipt.actor_id
  where account.id is null
 ) then
  raise exception using errcode='23503',message='UPLOADED_RECEIPT_ACTOR_ORPHANS_REQUIRE_REVIEW';
 end if;
end $$;
alter table public.uploaded_contract_receipts
 validate constraint uploaded_receipt_actor_account_fk;
