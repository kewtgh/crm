set lock_timeout = '5s';
set statement_timeout = '5min';

alter table public.contacts
  validate constraint contacts_workspace_organization_fk;
alter table public.opportunities
  validate constraint opportunities_workspace_organization_fk;
alter table public.opportunities
  validate constraint opportunities_workspace_contact_fk;
alter table public.opportunities
  validate constraint opportunities_workspace_product_fk;
alter table public.opportunities
  validate constraint opportunities_workspace_household_fk;
alter table public.contracts
  validate constraint contracts_workspace_organization_fk;
alter table public.contracts
  validate constraint contracts_workspace_product_fk;
alter table public.payments
  validate constraint payments_workspace_contract_fk;
alter table public.payments
  validate constraint payments_workspace_product_fk;
alter table public.quotes
  validate constraint quotes_workspace_organization_fk;
alter table public.quotes
  validate constraint quotes_workspace_opportunity_fk;
alter table public.quotes
  validate constraint quotes_workspace_product_fk;
