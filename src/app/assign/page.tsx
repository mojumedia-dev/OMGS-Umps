import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
  nowAsLeagueIso,
} from "@/lib/format";
import type { Game, User, AssignmentStatus, DivisionCode } from "@/lib/db/types";
import { LEAGUE_VENUE } from "@/lib/league";
import { assignUmpToGame } from "./actions";

export const dynamic = "force-dynamic";

type AssignmentRow = {
  id: string;
  status: AssignmentStatus;
  umpire: { id: string; full_name: string; avatar_url: string | null } | null;
};

export default async function AssignPage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "board" && user.role !== "admin") redirect("/dashboard");

  const sb = supabaseServer();
  const nowIso = nowAsLeagueIso();

  // Pull all assignment-only divisions (today: 8U)
  const { data: divisions } = await sb
    .from("divisions")
    .select("code, display_name, assignment_only")
    .eq("assignment_only", true);
  const assignmentOnlyCodes: DivisionCode[] = (divisions ?? []).map(
    (d) => d.code as DivisionCode
  );

  // Brooke's scope might further restrict (e.g. ['8U']). If both scope and
  // assignment_only set, intersect; if just one, use that.
  const targetDivisions = (user.scope_divisions && user.scope_divisions.length
    ? user.scope_divisions.filter((d) => assignmentOnlyCodes.includes(d as DivisionCode))
    : assignmentOnlyCodes) as DivisionCode[];

  if (targetDivisions.length === 0) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-sm text-zinc-700">
          No assignment-only divisions in your scope.
        </p>
      </main>
    );
  }

  // Upcoming games in the target divisions
  const { data: gamesData } = await sb
    .from("games")
    .select("*")
    .gte("starts_at", nowIso)
    .in("division_code", targetDivisions)
    .order("starts_at", { ascending: true })
    .limit(500);
  const games = (gamesData ?? []) as Game[];

  // Existing assignments for these games (any non-cancelled/declined)
  const gameIds = games.map((g) => g.id);
  let assignmentsByGame = new Map<string, AssignmentRow[]>();
  if (gameIds.length) {
    const { data: assn } = await sb
      .from("assignments")
      .select(
        "id, status, game_id, umpire:users!assignments_umpire_id_fkey(id, full_name, avatar_url)"
      )
      .in("game_id", gameIds)
      .in("status", ["assigned", "confirmed", "approved", "completed", "paid"]);
    assignmentsByGame = new Map();
    for (const a of (assn ?? []) as unknown as (AssignmentRow & { game_id: string })[]) {
      if (!assignmentsByGame.has(a.game_id)) assignmentsByGame.set(a.game_id, []);
      assignmentsByGame.get(a.game_id)!.push(a);
    }
  }

  // Eligible umps roster for the target divisions (overlap of eligible_divisions)
  const { data: rosterRaw } = await sb
    .from("users")
    .select("id, full_name, avatar_url, role, eligible_divisions, is_active")
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  const roster = ((rosterRaw ?? []) as Array<
    Pick<User, "id" | "full_name" | "avatar_url" | "role" | "eligible_divisions" | "is_active">
  >).filter(
    (u) =>
      u.eligible_divisions?.some((d) => targetDivisions.includes(d as DivisionCode)) &&
      u.role !== "board" /* don't pick board members as umps */
  );

  // Group by SLOT (date + field + division) so each weekday slot is one card.
  // Weekend games stay singleton slots.
  type SlotEntry = { key: string; games: Game[]; dateKey: string };
  const slotMap = new Map<string, SlotEntry>();
  for (const g of games) {
    const dateKey = formatGameDateKey(g.starts_at);
    const slotKey = `${dateKey}_${g.field}_${g.division_code}`;
    if (!slotMap.has(slotKey)) {
      slotMap.set(slotKey, { key: slotKey, games: [], dateKey });
    }
    slotMap.get(slotKey)!.games.push(g);
  }
  for (const s of slotMap.values()) {
    s.games.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  }
  const slots = [...slotMap.values()].sort((a, b) =>
    a.games[0].starts_at < b.games[0].starts_at ? -1 : 1
  );

  const grouped = new Map<string, SlotEntry[]>();
  for (const s of slots) {
    if (!grouped.has(s.dateKey)) grouped.set(s.dateKey, []);
    grouped.get(s.dateKey)!.push(s);
  }

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Assign umps
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {targetDivisions.join(", ")} · {games.length} upcoming · {roster.length}{" "}
            eligible umps
          </p>
        </div>

        {games.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">No upcoming games in scope.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([dateKey, daySlots]) => (
              <section key={dateKey}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {formatGameDate(daySlots[0].games[0].starts_at)}
                </h2>
                <ul className="space-y-2">
                  {daySlots.map((slot) => {
                    const firstGame = slot.games[0];
                    const allAssignmentsInSlot = slot.games.flatMap(
                      (g) => assignmentsByGame.get(g.id) ?? []
                    );
                    // Per-slot we expect each game to have ump_slots umps assigned;
                    // show the union of unique umps assigned across games in slot.
                    const umpsInSlot = Array.from(
                      new Map(
                        allAssignmentsInSlot
                          .filter((a) => a.umpire)
                          .map((a) => [a.umpire!.id, a])
                      ).values()
                    );
                    const slotsRemaining = firstGame.ump_slots - umpsInSlot.length;
                    const isBundle = slot.games.length > 1;
                    return (
                      <li
                        key={slot.key}
                        className="rounded-lg border border-zinc-200 bg-white p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 items-center rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                            {firstGame.division_code}
                          </span>
                          <a
                            href={LEAGUE_VENUE.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
                          >
                            {firstGame.field}
                          </a>
                          <span className="text-xs text-zinc-500">
                            {formatMoney(firstGame.pay_per_slot)} × {firstGame.ump_slots}
                          </span>
                          {isBundle && (
                            <span className="ml-auto inline-flex h-5 items-center rounded-full bg-brand-100 px-2 text-[10px] font-bold text-brand-800">
                              Bundle: {slot.games.length} games
                            </span>
                          )}
                        </div>
                        <ul className="mt-2 space-y-0.5 text-sm">
                          {slot.games.map((g) => (
                            <li key={g.id} className="flex gap-2">
                              <span className="w-16 shrink-0 font-mono text-xs text-zinc-500">
                                {formatGameTime(g.starts_at)}
                              </span>
                              <span className="truncate">
                                <span className="font-medium">{g.team_home}</span>{" "}
                                <span className="text-zinc-600">vs {g.team_away}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {umpsInSlot.map((a) => {
                            const tone =
                              a.status === "assigned"
                                ? "border-amber-300 bg-amber-50 text-amber-900"
                                : "border-brand-200 bg-lime-100 text-brand-900";
                            return (
                              <span
                                key={a.id}
                                className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${tone}`}
                                title={`${a.umpire?.full_name} · ${a.status}`}
                              >
                                {a.umpire?.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={a.umpire.avatar_url}
                                    alt=""
                                    className="h-4 w-4 rounded-full object-cover"
                                  />
                                ) : (
                                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-200 text-[8px] font-bold text-brand-800">
                                    {(a.umpire?.full_name ?? "U").charAt(0).toUpperCase()}
                                  </span>
                                )}
                                {a.umpire?.full_name?.split(" ")[0] ?? "?"}
                                {a.status === "assigned" ? " (pending)" : ""}
                              </span>
                            );
                          })}
                          {Array.from({ length: Math.max(0, slotsRemaining) }).map(
                            (_, i) => (
                              <span
                                key={`open-${i}`}
                                className="inline-flex h-6 items-center rounded-full border border-dashed border-zinc-300 px-2 text-[11px] font-medium text-zinc-500"
                              >
                                Open
                              </span>
                            )
                          )}
                        </div>
                        {slotsRemaining > 0 && (
                          <form
                            action={assignUmpToGame}
                            className="mt-3 flex flex-wrap items-center gap-2"
                          >
                            <input
                              type="hidden"
                              name="gameId"
                              value={firstGame.id}
                            />
                            <select
                              name="umpireId"
                              required
                              defaultValue=""
                              className="h-9 flex-1 min-w-40 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                            >
                              <option value="" disabled>
                                Pick ump
                              </option>
                              {roster.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="inline-flex h-9 items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
                            >
                              Assign{isBundle ? " all" : ""}
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
