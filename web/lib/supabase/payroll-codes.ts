// Payroll codes are private (the payslips leavers / private codes
// migration): staff.payroll_code can't be selected through the API. The
// owner (or the secret key) gets everyone's from staff_payroll_codes();
// anyone else gets only their own.

import type { SupabaseClient } from "@supabase/supabase-js";

/** staff id -> payroll code (people without a code are left out). */
export async function loadPayrollCodes(
  db: SupabaseClient,
): Promise<{ codes: Map<string, string>; error: { message: string } | null }> {
  const { data, error } = await db.rpc("staff_payroll_codes");
  const rows = (data ?? []) as { staff_id: string; payroll_code: string }[];
  return { codes: new Map(rows.map((r) => [r.staff_id, r.payroll_code])), error };
}
