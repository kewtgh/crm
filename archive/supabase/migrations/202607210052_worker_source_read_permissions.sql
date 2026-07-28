-- Workers execute through PostgREST as service_role. BYPASSRLS does not imply
-- SQL table privileges, so grant only the source reads used by the calendar and
-- privacy export processors.
grant select on
  public.appointments,
  public.appointment_attendees,
  public.contacts,
  public.privacy_requests,
  public.contact_consents,
  public.crm_activities,
  public.household_members,
  public.student_guardian_relationships,
  public.students,
  public.student_academic_records
to service_role;
