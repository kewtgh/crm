-- crm_system has INSERT privilege but remains NOBYPASSRLS. Its only direct
-- outbox producer is queueInvitation (creation and resend). Business producers
-- use their existing governed functions, so this policy admits only queued
-- staff invitations and requires the matching delivery lineage in this transaction.
-- The legacy migration 058 generated a generic internal policy on old tables;
-- retain that existing contract. This explicit policy also works on installations
-- where that generic policy is absent. No table privileges or roles are changed.
drop policy if exists "system inserts staff invitation outbox"
  on public.notification_outbox;

create policy "system inserts staff invitation outbox"
  on public.notification_outbox
  for insert to crm_system
  with check (
    channel = 'EMAIL'
    and template_key = 'staff-account-created'
    and exists (
      select 1 from public.staff_invitation_deliveries delivery
      where delivery.id = notification_outbox.id
        and delivery.outbox_id = notification_outbox.id
        and delivery.workspace_id = notification_outbox.workspace_id
        and delivery.user_id = notification_outbox.recipient_id
        and delivery.status = 'QUEUED'
    )
  );
