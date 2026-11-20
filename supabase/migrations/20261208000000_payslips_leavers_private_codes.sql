-- Payslips, part 2: final pay for leavers, and private payroll codes.
--
--   1. Leavers: the owner can upload a payslip for a turned-off person
--      (their final pay). The general active_staff_only trigger on
--      payslips.staff_id is replaced by one that skips the owner. Everyone
--      else (including a future email webhook using the secret key) is still
--      refused. The person still can't sign in, so the owner downloads it
--      from More > Payslips and sends it another way.
--   2. Payroll codes are private: only the owner and the person themselves
--      can read staff.payroll_code. Column privileges on staff: every
--      column except payroll_code is readable as before; the code is read
--      through staff_payroll_codes(), which returns everyone's for the owner
--      (or the secret key) and only your own for anyone else.
--      A NEW COLUMN ON staff NEEDS ITS OWN `grant select (col) on staff`.

-- 1. Leavers --------------------------------------------------------------------------------

drop trigger if exists active_staff_only on payslips;

-- Same rule and message as active_staff_only('staff_id', 'payslips'), except
-- for the owner. The name sorts before payslips_before_insert, as before.
create or replace function payslips_active_staff_only() returns trigger
language plpgsql as $$
begin
  if not is_owner() then
    perform require_active_staff(new.staff_id, 'payslips');
  end if;
  return new;
end;
$$;

revoke execute on function payslips_active_staff_only() from public, anon, authenticated;

create trigger active_staff_only before insert on payslips
  for each row execute function payslips_active_staff_only();

-- 2. Private payroll codes --------------------------------------------------------------------

-- Table-level select would include payroll_code; list the columns instead.
revoke select on staff from authenticated;
grant select (id, name, role, created_at, email, active, invited_at, deactivated_at, deactivated_by)
  on staff to authenticated;

-- Everyone's code for the owner (or the server's secret key, for a future
-- email webhook); only your own for anyone else.
create or replace function staff_payroll_codes()
returns table (staff_id uuid, payroll_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.payroll_code
  from staff s
  where s.payroll_code is not null
    and (
      is_owner()
      or (s.id = auth.uid() and is_active())
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    );
$$;

revoke execute on function staff_payroll_codes() from public, anon;
grant execute on function staff_payroll_codes() to authenticated, service_role;

comment on column staff.payroll_code is
  'The person''s employee code in Crystal Payroll. Private: read it through staff_payroll_codes() '
  '(owner: everyone; others: their own). Only set_staff_payroll_code changes it.';
