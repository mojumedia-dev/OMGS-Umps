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
import { LEAGUE_VENUE } from "@/lib/league";
import type { Game, AssignmentStatus, DivisionCode } from "@/lib/db/types";
import { transferAssignment } from "../actions";

export const dynamic = "force-dynamic";

type AssignmentRow = {
  id: string;
  status: AssignmentStatus;
  game_id: string;
  umpire: { id: string; full_name: string; avatar_url: string | null } | null;
};

export default async function ManageGamesPage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "uic" && user.role !== "admin") redirect("/dashboard");

  const sb = supabaseServer();
  const nowIso = nowAsLeagueIso();

  const { data: gamesData } = await sb
    .from("games")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(500);
  const games = (gamesData ?? []) as Game[];

  const gameIds = games.map((g) => g.id);
  let assignmentsByGame = new Map<string, AssignmentRow[]>();
  if (gameIds.length) {
    const { data: assn } = await sb
      .from("assignments")
      .select(
        "id, status, game_id, umpire:users!assignments_umpire_id_fkey(id, full_name, avatar_url)"
      )
      .in("game_id", gameIds)
      .in("status", ["requested", "assigned", "approved", "confirmed"]);
    assignmentsByGame = new Map();
    for (const a of (assn ?? []) as unknown as AssignmentRow[]) {
      if (!assignmentsByGame.has(a.game_id)) assignmentsByGame.set(a.game_id, []);
      assignmentsByGame.get(a.game_id)!.push(a);
    }
  }

  // Roster of all active umps (for transfer target picker)
  const { data: rosterRaw } = await sb
    .from("users")
    .select("id, full_name, eligible_divisions, role, is_active")
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  type RosterRow = {
    id: string;
    full_name: string;
    eligible_divisions: DivisionCode[] | null;
    role: string;
  };
  const roster = (rosterRaw ?? []) as RosterRow[];

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
            Manage assignments
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Transfer any active assignment to a different ump.
          </p>
        </div>

        <div className="space-y-6">
          {[...grouped.entries()].map(([dateKey, dayGames]) => (
            <details
              key={dateKey}
              className="group overflow-hidden rounded-lg border border-zinc-200 bg-white"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none hover:bg-zinc-50">
                <span className="text-zinc-400 transition-transform group-open:rotate-90">
                  ▶
                </span>
                <span className="text-sm font-semibold uppercase tracking-wide text-brand-800">
                  {formatGameDate(dayGames[0].starts_at)}
                </span>
              </summary>
              <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
                {dayGames.map((g) => {
                  const assigned = assignmentsByGame.get(g.id) ?? [];
                  const eligibleRoster = roster.filter((u) =>
                    u.eligible_divisions?.includes(g.division_code)
                  );
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
                              </a>{" "}
                              · {formatMoney(g.pay_per_slot)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-sm font-medium text-zinc-900">
                            {g.team_home} vs {g.team_away}
                          </div>
                        </div>
                      </div>
                      {assigned.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-500">No umps assigned.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {assigned.map((a) => (
                            <li
                              key={a.id}
                              className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5"
                            >
                              {a.umpire?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.umpire.avatar_url}
                                  alt=""
                                  className="h-6 w-6 rounded-full object-cover"
                                />
                              ) : (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-200 text-[10px] font-bold text-brand-800">
                                  {(a.umpire?.full_name ?? "U").charAt(0).toUpperCase()}
                                </span>
                              )}
                              <span className="text-sm font-semibold text-zinc-900">
                                {a.umpire?.full_name ?? "?"}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                                {a.status}
                              </span>
                              <form
                                action={transferAssignment}
                                className="ml-auto flex items-center gap-1"
                              >
                                <input
                                  type="hidden"
                                  name="assignmentId"
                                  value={a.id}
                                />
                                <select
                                  name="umpireId"
                                  defaultValue=""
                                  required
                                  className="h-7 max-w-44 rounded-md border border-zinc-300 bg-white px-1.5 text-xs"
                                >
                                  <option value="" disabled>
                                    Transfer to…
                                  </option>
                                  {eligibleRoster
                                    .filter((u) => u.id !== a.umpire?.id)
                                    .map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.full_name}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  type="submit"
                                  className="inline-flex h-7 items-center rounded-md bg-brand-600 px-2 text-[11px] font-bold text-white hover:bg-brand-700"
                                >
                                  Move
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </main>
  );
}
