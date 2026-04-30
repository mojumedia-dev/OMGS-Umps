import { NextResponse } from "next/server";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const user = await ensureCurrentUserRow();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== "board" && user.role !== "admin")
    return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to");

  const sb = supabaseServer();
  let q = sb
    .from("assignments")
    .select(
      `paid_at, paid_amount, status,
       game:games (division_code, team_home, team_away, field, starts_at, is_tournament),
       umpire:users!assignments_umpire_id_fkey (full_name, email, phone)`
    )
    .in("status", ["approved", "confirmed", "completed", "paid"]);

  if (from) q = q.gte("game.starts_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("game.starts_at", `${to}T23:59:59Z`);

  const { data, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });

  type Row = {
    paid_at: string | null;
    paid_amount: number | null;
    status: string;
    game: {
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
      is_tournament: boolean;
    } | null;
    umpire: { full_name: string; email: string | null; phone: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const header = [
    "game_date",
    "game_time",
    "division",
    "tournament",
    "field",
    "matchup",
    "umpire",
    "phone",
    "email",
    "amount",
    "status",
    "paid_at",
  ];
  const lines = [header.join(",")];

  for (const r of rows) {
    if (!r.game) continue;
    const d = new Date(r.game.starts_at);
    const date = r.game.starts_at.slice(0, 10);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
    lines.push(
      [
        csvEscape(date),
        csvEscape(time),
        csvEscape(r.game.division_code),
        csvEscape(r.game.is_tournament ? "yes" : "no"),
        csvEscape(r.game.field),
        csvEscape(`${r.game.team_home} vs ${r.game.team_away}`),
        csvEscape(r.umpire?.full_name ?? ""),
        csvEscape(r.umpire?.phone ?? ""),
        csvEscape(r.umpire?.email ?? ""),
        csvEscape(r.paid_amount ?? ""),
        csvEscape(r.status),
        csvEscape(r.paid_at ?? ""),
      ].join(",")
    );
  }

  const csv = lines.join("\n") + "\n";
  const filename = `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
