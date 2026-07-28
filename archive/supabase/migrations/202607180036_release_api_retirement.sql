-- v1.0.0: retire quote writers that predate product/bundle and currency locks.
-- Drafts created through these overloads cannot satisfy the v1.0 submit rules.

revoke all on function public.create_quote(
  text,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) from public,anon,authenticated;

revoke all on function public.add_quote_version(
  uuid,numeric,numeric,text,text,text
) from public,anon,authenticated;
