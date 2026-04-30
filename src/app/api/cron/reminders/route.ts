import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron hits this hourly. We push a reminder to every umpire whose
 * approved/confirmed game starts roughly 24h from now (within the next hour
 * window). Idempotency-tag prevents double-firing inside the same window.
 */
export async function GET(req: Request) {
  // Vercel Cron sends a Bearer token. In dev we let it through.
  if (process.env.NODE_ENV === "production") {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const now = Date.now();
  const windowStart = new Date(now + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 25 * 60 * 60 * 1000).toISOString();

  const sb = supabaseServer();
  const { data: rows, error } = await sb
    .from("assignments")
    .select(
      `id, umpire_id,
       game:games (id, division_code, team_home, team_away, field, starts_at)`
    )
    .in("status", ["approved", "confirmed"])
    .gte("game.starts_at", windowStart)
    .lt("game.starts_at", windowEnd);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  type Row = {
    id: string;
    umpire_id: string;
    game: {
      id: string;
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
    } | null;
  };

  const items = ((rows ?? []) as unknown as Row[]).filter((r) => !!r.game);

  let sent = 0;
  for (const r of items) {
    const g = r.game!;
    const t = new Date(g.starts_at).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    });
    await sendPushToUser(r.umpire_id, {
      title: "Game tomorrow ⚾",
      body: `${g.division_code} · ${t} · ${g.field}`,
      url: "/dashboard",
      tag: `reminder-${g.id}`,
    });
    sent++;
  }

  return NextResponse.json({ ok: true, candidates: items.length, sent });
}
