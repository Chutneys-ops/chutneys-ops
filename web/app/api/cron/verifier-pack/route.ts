// POST /api/cron/verifier-pack: the monthly copy of the verifier pack.
//
// Supabase pg_cron calls this every day (run_verifier_pack() in the
// verifier packs migration) with "Authorization: Bearer <CRON_SECRET>".
// Anything without the right secret gets 401, before any work is done.
//
// Each run:
//   1. works out last month (Auckland time);
//   2. if "verifier-packs" already has that month's file, stops: so the pack
//      is made on the 1st, and a failed night is retried the next day;
//   3. otherwise builds every site's pack for that month with the admin
//      client (there's no signed-in person; the secret is the check) and
//      stores it at <year>/<year>-<month>.pdf. A stored copy is never replaced.

import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { aucklandDate } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPackInput } from "@/lib/supabase/verifier-pack";
import {
  buildPack,
  isMonth,
  monthBounds,
  monthLabel,
  monthlyPackPath,
  PACK_BUCKET,
  previousMonth,
} from "@/lib/verifier-pack";
import { renderPackPdf } from "@/lib/verifier-pack-pdf";

// A month of every site can take a while to draw.
export const maxDuration = 300;

/** For local testing only: {"month": "2026-09"} makes that (finished)
 *  month's copy. Ignored in production, where it's always last month. */
async function chosenMonth(request: NextRequest): Promise<string> {
  const today = aucklandDate();
  const lastMonth = previousMonth(today);
  if (process.env.NODE_ENV === "production") return lastMonth;
  try {
    const body = (await request.json()) as { month?: unknown };
    return isMonth(body?.month) && body.month < today.slice(0, 7) ? body.month : lastMonth;
  } catch {
    return lastMonth;
  }
}

export async function POST(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const month = await chosenMonth(request);
  const path = monthlyPackPath(month);
  try {
    const admin = createAdminClient();
    const bucket = admin.storage.from(PACK_BUCKET);

    const { data: existing, error: listError } = await bucket.list(month.slice(0, 4), { search: `${month}.pdf` });
    if (listError) throw new Error(listError.message);
    if ((existing ?? []).some((f) => f.name === `${month}.pdf`)) {
      return NextResponse.json({ month, path, status: "already stored" });
    }

    const { from, to } = monthBounds(month);
    const pack = buildPack(await loadPackInput(admin, { siteId: null, from, to }));
    const pdf = await renderPackPdf(pack, {
      generatedBy: "Chutneys Ops (automatic monthly copy)",
      generatedAt: new Date(),
      subtitle: `Monthly copy: ${monthLabel(month)}`,
    });

    // upsert: false: never overwrite a stored copy. Two runs at once: the
    // second one's upload fails with "already exists", which is fine.
    const { error: uploadError } = await bucket.upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      if (/exists|duplicate/i.test(uploadError.message)) {
        return NextResponse.json({ month, path, status: "already stored" });
      }
      throw new Error(uploadError.message);
    }
    return NextResponse.json({ month, path, status: "stored", bytes: pdf.length, sites: pack.parts.length });
  } catch (error) {
    console.error("Monthly verifier pack failed:", (error as Error).message);
    return NextResponse.json({ error: "Monthly verifier pack failed", month }, { status: 500 });
  }
}
