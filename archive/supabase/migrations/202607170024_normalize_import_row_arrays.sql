-- A SELECT ... INTO with no duplicate candidate assigns NULL to every target
-- variable. Normalize JSON array columns at the table boundary so valid rows
-- keep the documented empty-array representation.

create or replace function public.normalize_import_row_arrays()
returns trigger language plpgsql set search_path=public
as $$
begin
  new.errors := coalesce(new.errors, '[]'::jsonb);
  new.duplicate_reasons := coalesce(new.duplicate_reasons, '[]'::jsonb);
  return new;
end;
$$;

drop trigger if exists normalize_import_row_arrays on public.import_rows;
create trigger normalize_import_row_arrays
before insert or update of errors, duplicate_reasons on public.import_rows
for each row execute procedure public.normalize_import_row_arrays();
