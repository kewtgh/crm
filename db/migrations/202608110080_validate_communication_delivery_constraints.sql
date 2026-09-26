-- Complete the expand-only delivery transition after the Worker switch.
-- PostgreSQL validates existing rows without rewriting or deleting them. A
-- violating legacy row blocks this forward migration so it can be repaired
-- explicitly before retrying; it must not be silently coerced.
alter table public.communication_messages
  validate constraint communication_messages_delivery_status_check;
alter table public.communication_messages
  validate constraint communication_messages_delivery_direction_check;
alter table public.communication_messages
  validate constraint communication_messages_delivery_lease_check;
alter table public.communication_messages
  validate constraint communication_messages_provider_attempt_check;
alter table public.communication_messages
  validate constraint communication_messages_sent_receipt_check;
alter table public.communication_messages
  validate constraint communication_messages_uncertain_check;
alter table public.communication_messages
  validate constraint communication_messages_dead_letter_check;
alter table public.communication_messages
  validate constraint communication_messages_provider_timestamps_check;
alter table public.communication_messages
  validate constraint communication_messages_delivery_failure_code_check;
