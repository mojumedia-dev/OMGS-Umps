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

  // Group games by date for display
  const grouped = new Map<string, Game[]>();
  for (const g of games) {
    const key = formatGameDateKey(g.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(g);
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
            {[...grouped.entries()].map(([dateKey, dayGames]) => (
              <section key={dateKey}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {formatGameDate(dayGames[0].starts_at)}
                </h2>
                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {dayGames.map((g) => {
                    const assigned = assignmentsByGame.get(g.id) ?? [];
                    const filled = assigned.length;
                    const remaining = g.ump_slots - filled;
                    return (
                      <li key={g.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-5 items-center rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                                {g.division_code}
                              </span>
                              <span className="text-sm text-zinc-500">
                                {formatGameTime(g.starts_at)} ·{" "}
                                <a
                                  href={LEAGUE_VENUE.mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-700 underline-offset-2 hover:underline"
                                >
                                  {g.field}
                                </a>
                              </span>
                              <span className="text-xs text-zinc-400">
                                {formatMoney(g.pay_per_slot)} × {g.ump_slots}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-sm font-medium text-zinc-900">
                              {g.team_home} vs {g.team_away}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {assigned.map((a) => {
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
                                    {a.umpire?.full_name?.split(" ")[0] ?? "?"}{" "}
                                    {a.status === "assigned" ? "(pending)" : ""}
                                  </span>
                                );
                              })}
                              {Array.from({ length: Math.max(0, remaining) }).map(
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
                          </div>
                          {remaining > 0 && (
                            <form
                              action={assignUmpToGame}
                              className="flex shrink-0 items-center gap-1"
                            >
                              <input type="hidden" name="gameId" value={g.id} />
                              <select
                                name="umpireId"
                                required
                                defaultValue=""
                                className="h-9 w-44 rounded-md border border-zinc-300 bg-white px-2 text-xs"
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
                                className="inline-flex h-9 items-center justify-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
                              >
                                Assign
                              </button>
                            </form>
                          )}
                        </div>
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
