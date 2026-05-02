import Link from "next/link";
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
import { transferAssignment, cancelAssignmentAsUic } from "../actions";

export const dynamic = "force-dynamic";

type AssignmentRow = {
  id: string;
  status: AssignmentStatus;
  game_id: string;
  umpire: { id: string; full_name: string; avatar_url: string | null } | null;
};

function buildHref(opts: { view?: string; ump?: string; divisions?: string }): string {
  const qs = new URLSearchParams();
  if (opts.view && opts.view !== "list") qs.set("view", opts.view);
  if (opts.ump) qs.set("ump", opts.ump);
  if (opts.divisions) qs.set("divisions", opts.divisions);
  const s = qs.toString();
  return s ? `/uic/games?${s}` : "/uic/games";
}

export default async function ManageGamesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    view?: string;
    focus?: string;
    ump?: string;
    divisions?: string;
  }>;
}) {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "uic" && user.role !== "admin") redirect("/dashboard");

  const params = (await searchParams) ?? {};
  const view = params.view === "month" ? "month" : "list";
  const focus = params.focus ?? null;
  const filterUmp = params.ump ?? "";
  const filterDivisions = params.divisions
    ? params.divisions.split(",").filter(Boolean)
    : [];

  const sb = supabaseServer();
  const nowIso = nowAsLeagueIso();

  // If a ump filter is set, fetch their game IDs first to constrain the games query
  let umpGameIds: string[] | null = null;
  if (filterUmp) {
    const { data: theirAssn } = await sb
      .from("assignments")
      .select("game_id")
      .eq("umpire_id", filterUmp)
      .in("status", ["requested", "assigned", "approved", "confirmed", "paid"]);
    umpGameIds = (theirAssn ?? []).map((a) => a.game_id);
    if (umpGameIds.length === 0) umpGameIds = ["__none__"]; // forces empty result
  }

  let gamesQuery = sb
    .from("games")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (filterDivisions.length) {
    gamesQuery = gamesQuery.in("division_code", filterDivisions);
  }
  if (umpGameIds) gamesQuery = gamesQuery.in("id", umpGameIds);
  const { data: gamesData } = await gamesQuery;
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
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Manage assignments
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Transfer any active assignment to a different ump.
            </p>
          </div>
          <div className="flex rounded-md border border-zinc-300 bg-white p-0.5 text-xs font-bold">
            <Link
              href={buildHref({ view: "list", ump: filterUmp, divisions: filterDivisions.join(",") })}
              className={`inline-flex h-8 items-center rounded px-3 transition-colors ${
                view === "list"
                  ? "bg-brand-600 text-white"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              List
            </Link>
            <Link
              href={buildHref({ view: "month", ump: filterUmp, divisions: filterDivisions.join(",") })}
              className={`inline-flex h-8 items-center rounded px-3 transition-colors ${
                view === "month"
                  ? "bg-brand-600 text-white"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              Month
            </Link>
          </div>
        </div>

        <form
          method="GET"
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-3"
        >
          {view === "month" && (
            <input type="hidden" name="view" value="month" />
          )}
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">Ump</span>
            <select
              name="ump"
              defaultValue={filterUmp}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            >
              <option value="">All umps</option>
              {roster.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">Division</span>
            <select
              name="divisions"
              defaultValue={filterDivisions[0] ?? ""}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            >
              <option value="">All divisions</option>
              {(["8U", "10U", "12U", "14U", "16U", "18U"] as const).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
            >
              Apply
            </button>
            {(filterUmp || filterDivisions.length > 0) && (
              <Link
                href="/uic/games"
                className="inline-flex h-9 items-center text-xs font-semibold text-zinc-600 underline-offset-2 hover:underline"
              >
                Clear
              </Link>
            )}
          </div>
        </form>

        {view === "month" ? (
          <ManageMonthGrid grouped={grouped} assignmentsByGame={assignmentsByGame} />
        ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([dateKey, dayGames]) => {
            const total = dayGames.length;
            const openForDay = dayGames.filter((g) => {
              const filled = assignmentsByGame.get(g.id)?.length ?? 0;
              return filled < g.ump_slots;
            }).length;
            return (
            <details
              key={dateKey}
              id={`day-${dateKey}`}
              open={focus === dateKey}
              className="group overflow-hidden rounded-lg border border-zinc-200 bg-white"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none hover:bg-zinc-50">
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 transition-transform group-open:rotate-90">
                    ▶
                  </span>
                  <span className="text-sm font-semibold uppercase tracking-wide text-brand-800">
                    {formatGameDate(dayGames[0].starts_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {openForDay > 0 ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2 font-semibold text-amber-900">
                      {openForDay} open
                    </span>
                  ) : (
                    <span className="inline-flex h-6 items-center rounded-full bg-lime-200 px-2 font-semibold text-brand-900">
                      full
                    </span>
                  )}
                  <span className="inline-flex h-6 items-center rounded-full bg-zinc-100 px-2 font-medium text-zinc-700">
                    {total} total
                  </span>
                </div>
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
                                action={cancelAssignmentAsUic}
                                className="ml-auto"
                              >
                                <input
                                  type="hidden"
                                  name="assignmentId"
                                  value={a.id}
                                />
                                <input
                                  type="hidden"
                                  name="scope"
                                  value="single"
                                />
                                <button
                                  type="submit"
                                  className="text-[11px] text-zinc-500 underline-offset-2 hover:text-red-700 hover:underline"
                                  title="Cancel just this game"
                                >
                                  Cancel
                                </button>
                              </form>
                              <form
                                action={transferAssignment}
                                className="flex flex-wrap items-center gap-1"
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
                                  className="h-7 max-w-40 rounded-md border border-zinc-300 bg-white px-1.5 text-xs"
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
                                <select
                                  name="scope"
                                  defaultValue="single"
                                  className="h-7 rounded-md border border-zinc-300 bg-white px-1.5 text-xs"
                                  title="Move just this game or the whole same-field/day/division bundle"
                                >
                                  <option value="single">This game</option>
                                  <option value="bundle">Whole bundle</option>
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
            );
          })}
        </div>
        )}
      </div>
    </main>
  );
}

function ManageMonthGrid({
  grouped,
  assignmentsByGame,
}: {
  grouped: Map<string, Game[]>;
  assignmentsByGame: Map<string, AssignmentRow[]>;
}) {
  if (grouped.size === 0) return null;
  const firstKey = [...grouped.keys()][0];
  const lastKey = [...grouped.keys()][grouped.size - 1];
  const first = new Date(firstKey + "T00:00:00Z");
  const last = new Date(lastKey + "T00:00:00Z");
  const months: { y: number; m: number }[] = [];
  const cur = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
  while (cur <= end) {
    months.push({ y: cur.getUTCFullYear(), m: cur.getUTCMonth() });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      {months.map(({ y, m }) => {
        const monthName = new Date(Date.UTC(y, m, 1)).toLocaleDateString(
          "en-US",
          { month: "long", year: "numeric", timeZone: "UTC" }
        );
        const firstOfMonth = new Date(Date.UTC(y, m, 1));
        const startWeekday = firstOfMonth.getUTCDay();
        const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const cells: ({ day: number; key: string } | null)[] = [];
        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let d = 1; d <= lastDayOfMonth; d++) {
          const dt = new Date(Date.UTC(y, m, d));
          cells.push({ day: d, key: dt.toISOString().slice(0, 10) });
        }
        while (cells.length % 7 !== 0) cells.push(null);
        return (
          <section
            key={`${y}-${m}`}
            className="rounded-lg border border-zinc-200 bg-white"
          >
            <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-bold uppercase tracking-wide text-brand-800">
              {monthName}
            </h2>
            <div className="grid grid-cols-7 gap-px border-b border-zinc-200 bg-zinc-100 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              {weekdays.map((d) => (
                <div key={d} className="bg-white py-1.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-zinc-100">
              {cells.map((cell, i) => {
                if (!cell) return <div key={i} className="bg-white aspect-square" />;
                const dayGames = grouped.get(cell.key) ?? [];
                const total = dayGames.length;
                const openForDay = dayGames.filter((g) => {
                  const filled = assignmentsByGame.get(g.id)?.length ?? 0;
                  return filled < g.ump_slots;
                }).length;
                const isToday = cell.key === todayKey;
                const cellBg =
                  total === 0
                    ? "bg-white"
                    : openForDay > 0
                    ? "bg-amber-50"
                    : "bg-lime-50";
                const inner = (
                  <div
                    className={`flex h-full flex-col p-1.5 sm:p-2 ${cellBg} ${
                      isToday ? "ring-2 ring-inset ring-brand-600" : ""
                    }`}
                  >
                    <span
                      className={`text-xs font-semibold ${
                        total > 0 ? "text-zinc-900" : "text-zinc-400"
                      }`}
                    >
                      {cell.day}
                    </span>
                    {total > 0 && (
                      <div className="mt-auto flex flex-col gap-0.5 text-[10px] leading-tight">
                        {openForDay > 0 ? (
                          <span className="rounded bg-amber-200 px-1 font-bold text-amber-900">
                            {openForDay} open
                          </span>
                        ) : (
                          <span className="rounded bg-lime-200 px-1 font-bold text-brand-900">
                            full
                          </span>
                        )}
                        <span className="text-[9px] text-zinc-600">
                          {total} total
                        </span>
                      </div>
                    )}
                  </div>
                );
                return (
                  <div key={i} className="min-h-16 sm:aspect-square">
                    {total > 0 ? (
                      <Link
                        href={`/uic/games?focus=${cell.key}`}
                        className="block h-full"
                      >
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
