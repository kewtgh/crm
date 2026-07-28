do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    begin perform cron.unschedule('lumina-crm-due-reminders'); exception when others then null; end;
    perform cron.schedule('lumina-crm-due-reminders','* * * * *','select public.process_due_reminders(100);');
  else
    raise notice 'pg_cron is unavailable; configure an external scheduler to call process_due_reminders';
  end if;
exception when others then
  raise notice 'Reminder cron could not be installed (%); configure an external scheduler instead', sqlerrm;
end $$;
