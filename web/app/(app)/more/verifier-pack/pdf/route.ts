// /more/verifier-pack/pdf?site=<id|all>&from=YYYY-MM-DD&to=YYYY-MM-DD[&download=1]
//
// The verifier pack as a PDF, made on demand. Managers and the owner only:
// the role is checked here, so staff typing the URL get 403. Everything is
// read with the caller's own session, so RLS decides what's in it.
// Nothing is stored; the monthly copies are made by /api/cron/verifier-pack.

import { NextResponse } from "next/server";
import { aucklandDate } from "@/lib/dates";
import { loadPackInput } from "@/lib/supabase/verifier-pack";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { buildPack, packFileName, rangeError } from "@/lib/verifier-pack";
import { renderPackPdf } from "@/lib/verifier-pack-pdf";

// A busy 92 days of every site takes a few seconds to draw.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  if (!me || !isManager(me)) return new NextResponse("Only managers and the owner can make a verifier pack", { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const site = url.searchParams.get("site") ?? "all";
  const problem = rangeError(from, to, aucklandDate());
  if (problem) return new NextResponse(problem, { status: 400 });
  if (site !== "all" && !UUID_RE.test(site)) return new NextResponse("Unknown site", { status: 400 });
  const siteId = site === "all" ? null : site;

  try {
    const input = await loadPackInput(supabase, { siteId, from: from!, to: to! });
    if (siteId && input.sites.length === 0) return new NextResponse("Unknown site", { status: 404 });
    const pack = buildPack(input);
    const pdf = await renderPackPdf(pack, { generatedBy: `${me.name} (${me.role})`, generatedAt: new Date() });

    const fileName = packFileName(siteId ? input.sites[0].name : null, from!, to!);
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Verifier pack failed:", (error as Error).message);
    return new NextResponse("Could not make the verifier pack. Try again, or choose a shorter range.", { status: 500 });
  }
}
