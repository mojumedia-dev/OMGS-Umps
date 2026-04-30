import { NextResponse } from "next/server";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/**
 * Format a "naive UTC" timestamp (which we use to encode wall-clock Mountain time)
 * as an .ics local-time stamp with TZID America/Denver. Calendar apps will then
 * render it correctly with DST.
 */
function icsLocal(iso: string): string {
  const d = new Date(iso);
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await ensureCurrentUserRow();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("assignments")
    .select(
      `id, status, umpire_id,
       game:games (division_code, team_home, team_away, field, starts_at, ends_at, pay_per_slot)`
    )
    .eq("id", id)
    .single();
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  // Only the umpire on the assignment (or staff) can pull the .ics
  const isStaff =
    user.role === "uic" || user.role === "admin" || user.role === "board";
  if (data.umpire_id !== user.id && !isStaff)
    return new NextResponse("Forbidden", { status: 403 });

  const g = data.game as unknown as {
    division_code: string;
    team_home: string;
    team_away: string;
    field: string;
    starts_at: string;
    ends_at: string;
    pay_per_slot: number;
  } | null;
  if (!g) return new NextResponse("Game missing", { status: 404 });

  const summary = `Umpire: ${g.division_code} ${g.team_home} vs ${g.team_away}`;
  const description = `OMGS umpiring assignment\\nDivision: ${g.division_code}\\nField: ${g.field}\\nPay: $${g.pay_per_slot}\\nStatus: ${data.status}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OMGS Umps//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:America/Denver",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0700",
    "TZNAME:MST",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0600",
    "TZNAME:MDT",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${data.id}@omgs-umps.vercel.app`,
    `DTSTAMP:${icsLocal(new Date().toISOString())}Z`,
    `DTSTART;TZID=America/Denver:${icsLocal(g.starts_at)}`,
    `DTEND;TZID=America/Denver:${icsLocal(g.ends_at)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(g.field)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="omgs-game-${data.id.slice(0, 8)}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
