import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase/server";
import { ensureCurrentUserRow } from "@/lib/users";
import { toggleTournament } from "@/app/uic/actions";
import { LEAGUE_VENUE } from "@/lib/league";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
  nowAsLeagueIso,
} from "@/lib/format";
import type { Game, Assignment } from "@/lib/db/types";
import { requestGame, cancelMyRequest, requestGameWithExtras } from "./actions";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES: Assignment["status"][] = [
  "requested",
  "approved",
  "confirmed",
  "completed",
  "paid",
];

type AssignmentRowLite = Pick<
  Assignment,
  "id" | "game_id" | "umpire_id" | "status"
> & {
  umpire: { full_name: string; avatar_url: string | null } | null;
};

export default async function GamesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    view?: string;
    focus?: string;
    scope?: string;
    divisions?: string;
  }>;
}) {
  const { userId } = await auth();
  const user = userId ? await ensureCurrentUserRow() : null;
  const isUic = user?.role === "uic" || user?.role === "admin";
  const params = (await searchParams) ?? {};
  const view = params.view === "month" ? "month" : "list";
  const focus = params.focus ?? null;
  // Admins can preview a scoped view, e.g. ?scope=8U
  const adminScope =
    user?.role === "admin" && params.scope
      ? params.scope.split(",").filter(Boolean)
      : null;
  const divisionFilter = params.divisions
    ? params.divisions.split(",").filter(Boolean)
    : null;

  const sb = supabaseServer();
  const nowIso = nowAsLeagueIso();

  // Pull divisions so we know which are assignment-only (e.g. 8U)
  const { data: divisionsData } = await sb
    .from("divisions")
    .select("code, assignment_only");
  const assignmentOnlyCodes = new Set(
    (divisionsData ?? [])
      .filter((d) => d.assignment_only)
      .map((d) => d.code as string)
  );

  let gamesQuery = sb
    .from("games")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(500);
  const effectiveScope = adminScope ?? user?.scope_divisions ?? null;
  // Layer the filters: scope (role-based, hard) ⋂ eligible (profile, hard for umps) ⋂ chips (UI)
  // Admins previewing a scope skip the eligible filter so they see everything in scope.
  const eligibleFilter =
    user && user.role === "umpire" && user.eligible_divisions?.length
      ? user.eligible_divisions
      : null;
  let activeDivisions: string[] | null = null;
  const layers = [effectiveScope, eligibleFilter, divisionFilter].filter(
    (l): l is string[] => !!l && l.length > 0
  );
  if (layers.length === 0) {
    activeDivisions = null;
  } else {
    activeDivisions = layers.reduce((acc: string[] | null, l) => {
      if (!acc) return l;
      return acc.filter((d) => l.includes(d));
    }, null);
  }
  if (activeDivisions && activeDivisions.length) {
    gamesQuery = gamesQuery.in("division_code", activeDivisions);
  }
  // Allowed divisions for chip rendering = scope ⋂ eligible (or just scope/eligible/all)
  const allowedDivisions = (() => {
    let result: string[] = ["8U", "10U", "12U", "14U", "16U", "18U"];
    if (effectiveScope)
      result = result.filter((d) => (effectiveScope as string[]).includes(d));
    if (eligibleFilter)
      result = result.filter((d) => (eligibleFilter as string[]).includes(d));
    return result;
  })();
  const [{ data: gamesData, error: gamesErr }, { data: allActive, error: assnErr }] = await Promise.all([
    gamesQuery,
    sb
      .from("assignments")
      .select(
        "id, game_id, umpire_id, status, umpire:users!assignments_umpire_id_fkey(full_name, avatar_url)"
      )
      .in("status", ACTIVE_STATUSES),
  ]);

  if (gamesErr || assnErr) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">
          Failed to load: {gamesErr?.message ?? assnErr?.message}
        </p>
      </main>
    );
  }

  const games = (gamesData ?? []) as Game[];
  const assignments = (allActive ?? []) as unknown as AssignmentRowLite[];

  const assignmentsByGame = new Map<string, AssignmentRowLite[]>();
  const myAssignmentByGame = new Map<string, AssignmentRowLite>();
  for (const a of assignments) {
    if (!assignmentsByGame.has(a.game_id)) assignmentsByGame.set(a.game_id, []);
    assignmentsByGame.get(a.game_id)!.push(a);
    if (user && a.umpire_id === user.id) myAssignmentByGame.set(a.game_id, a);
  }

  // Compute the set of game IDs that conflict with my existing active assignments
  const myBusyWindows: { starts_at: string; ends_at: string }[] = [];
  if (user) {
    for (const a of assignments) {
      if (a.umpire_id !== user.id) continue;
      const g = games.find((g) => g.id === a.game_id);
      if (g) myBusyWindows.push({ starts_at: g.starts_at, ends_at: g.ends_at });
    }
  }
  const conflictGameIds = new Set<string>();
  if (user) {
    for (const g of games) {
      if (myAssignmentByGame.has(g.id)) continue; // it's one of mine — not a conflict
      const hits = myBusyWindows.some(
        (w) => g.starts_at < w.ends_at && g.ends_at > w.starts_at
      );
      if (hits) conflictGameIds.add(g.id);
    }
  }

  const grouped = new Map<string, Game[]>();
  for (const g of games) {
    const key = formatGameDateKey(g.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(g);
  }

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              All games
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {games.length} upcoming · {grouped.size} game days
            </p>
          </div>
          <div className="flex rounded-md border border-zinc-300 bg-white p-0.5 text-xs font-bold">
            <Link
              href="/games"
              className={`inline-flex h-8 items-center rounded px-3 transition-colors ${
                view === "list"
                  ? "bg-brand-600 text-white"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              List
            </Link>
            <Link
              href="/games?view=month"
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

        {!user && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <Link href="/sign-in" className="font-medium text-amber-900 underline">
              Sign in
            </Link>{" "}
            <span className="text-amber-800">to request games.</span>
          </div>
        )}

        {adminScope && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-xs">
            <span className="font-semibold text-brand-800">
              Previewing {adminScope.join(", ")} scope
            </span>
            <Link
              href="/games"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          </div>
        )}

        {allowedDivisions.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(() => {
              const baseQs = new URLSearchParams();
              if (view === "month") baseQs.set("view", "month");
              if (adminScope) baseQs.set("scope", adminScope.join(","));
              const allHref = baseQs.toString()
                ? `/games?${baseQs.toString()}`
                : "/games";
              const allActive = !divisionFilter || divisionFilter.length === 0;
              return (
                <>
                  <Link
                    href={allHref}
                    className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-bold transition-colors ${
                      allActive
                        ? "bg-brand-600 text-white"
                        : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    All
                  </Link>
                  {allowedDivisions.map((d) => {
                    const qs = new URLSearchParams(baseQs);
                    qs.set("divisions", d);
                    const active =
                      divisionFilter?.length === 1 && divisionFilter[0] === d;
                    return (
                      <Link
                        key={d}
                        href={`/games?${qs.toString()}`}
                        className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-bold transition-colors ${
                          active
                            ? "bg-brand-600 text-white"
                            : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                        }`}
                      >
                        {d}
                      </Link>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

        {view === "month" ? (
          <MonthGrid grouped={grouped} assignmentsByGame={assignmentsByGame} />
        ) : (
        <div className="space-y-3">
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
                <div className="border-t border-zinc-200">
                {(() => {
                  // Group by field, then by division within each field, sorted by time
                  const byField = new Map<string, Game[]>();
                  for (const g of dayGames) {
                    if (!byField.has(g.field)) byField.set(g.field, []);
                    byField.get(g.field)!.push(g);
                  }
                  const sortedFields = [...byField.entries()].sort(
                    ([a], [b]) => a.localeCompare(b)
                  );
                  return sortedFields.map(([field, fieldGames]) => (
                    <div key={field}>
                      <div className="bg-zinc-50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                        {field}
                      </div>
                      <ul className="divide-y divide-zinc-200">
                        {fieldGames.map((g) => {
                  const gameAssignments = assignmentsByGame.get(g.id) ?? [];
                  const filled = gameAssignments.length;
                  const remaining = g.ump_slots - filled;
                  const mine = myAssignmentByGame.get(g.id);
                  const isWeekend = (() => {
                    const dow = new Date(g.starts_at).getUTCDay();
                    return dow === 0 || dow === 6;
                  })();
                  const siblings = isWeekend
                    ? dayGames.filter(
                        (x) =>
                          x.id !== g.id &&
                          x.field === g.field &&
                          x.division_code === g.division_code
                      )
                    : [];
                  return (
                    <li key={g.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
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
                                title={LEAGUE_VENUE.address}
                              >
                                {g.field}
                              </a>
                            </span>
                          </div>
                          <div className="mt-1.5 truncate text-sm font-medium text-zinc-900">
                            {g.team_home}
                          </div>
                          <div className="truncate text-sm text-zinc-700">
                            vs {g.team_away}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {gameAssignments.map((a) => (
                              <UmpPill key={a.id} a={a} />
                            ))}
                            {Array.from({ length: Math.max(0, remaining) }).map((_, i) => (
                              <span
                                key={`open-${i}`}
                                className="inline-flex h-6 items-center rounded-full border border-dashed border-zinc-300 px-2 text-[11px] font-medium text-zinc-500"
                              >
                                Open
                              </span>
                            ))}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
                            <span>{formatMoney(g.pay_per_slot)}/ump</span>
                            {g.is_tournament && (
                              <span className="inline-flex h-5 items-center rounded-full bg-lime-200 px-2 text-[10px] font-bold uppercase text-brand-900">
                                Tournament
                              </span>
                            )}
                            {isUic && (
                              <form action={toggleTournament} className="inline">
                                <input type="hidden" name="gameId" value={g.id} />
                                <button
                                  type="submit"
                                  className="text-[11px] underline-offset-2 hover:underline"
                                  title={g.is_tournament ? "Mark as regular game" : "Mark as tournament"}
                                >
                                  {g.is_tournament ? "Unmark tournament" : "Mark tournament"}
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <GameAction
                            user={user}
                            game={g}
                            mine={mine}
                            remaining={remaining}
                            conflicts={conflictGameIds.has(g.id)}
                            weekendSiblings={siblings}
                            myAssignmentByGame={myAssignmentByGame}
                            assignmentsByGame={assignmentsByGame}
                            assignmentOnly={assignmentOnlyCodes.has(g.division_code)}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
                      </ul>
                    </div>
                  ));
                })()}
                </div>
              </details>
            );
          })}
        </div>
        )}
      </div>
    </main>
  );
}

function MonthGrid({
  grouped,
  assignmentsByGame,
}: {
  grouped: Map<string, Game[]>;
  assignmentsByGame: Map<
    string,
    { id: string; status: Assignment["status"] }[]
  >;
}) {
  if (grouped.size === 0) return null;
  const firstKey = [...grouped.keys()][0];
  const lastKey = [...grouped.keys()][grouped.size - 1];
  const first = new Date(firstKey + "T00:00:00Z");
  const last = new Date(lastKey + "T00:00:00Z");

  // Render each calendar month spanning the season
  const months: { y: number; m: number }[] = [];
  const cur = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
  while (cur <= end) {
    months.push({ y: cur.getUTCFullYear(), m: cur.getUTCMonth() });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  return (
    <div className="space-y-6">
      {months.map(({ y, m }) => (
        <MonthBlock
          key={`${y}-${m}`}
          year={y}
          month={m}
          grouped={grouped}
          assignmentsByGame={assignmentsByGame}
        />
      ))}
    </div>
  );
}

function MonthBlock({
  year,
  month,
  grouped,
  assignmentsByGame,
}: {
  year: number;
  month: number;
  grouped: Map<string, Game[]>;
  assignmentsByGame: Map<
    string,
    { id: string; status: Assignment["status"] }[]
  >;
}) {
  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" }
  );
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startWeekday = firstOfMonth.getUTCDay(); // 0=Sun
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: ({ day: number; key: string } | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDayOfMonth; d++) {
    const dt = new Date(Date.UTC(year, month, d));
    cells.push({ day: d, key: dt.toISOString().slice(0, 10) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
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
          const inner = (
            <div
              className={`flex h-full flex-col bg-white p-1.5 sm:p-2 ${
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
                  <span className="rounded bg-brand-100 px-1 font-bold text-brand-800">
                    {total} game{total === 1 ? "" : "s"}
                  </span>
                  {openForDay > 0 && (
                    <span className="rounded bg-amber-100 px-1 font-semibold text-amber-900">
                      {openForDay} open
                    </span>
                  )}
                </div>
              )}
            </div>
          );
          return (
            <div key={i} className="aspect-square min-h-12">
              {total > 0 ? (
                <Link href={`/games?focus=${cell.key}`} className="block h-full">
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
}

function UmpPill({
  a,
}: {
  a: {
    status: Assignment["status"];
    umpire: { full_name: string; avatar_url: string | null } | null;
  };
}) {
  const name = a.umpire?.full_name ?? "Umpire";
  const display =
    name.split(" ").length > 1
      ? `${name.split(" ")[0]} ${name.split(" ").slice(-1)[0][0]}.`
      : name;
  const tone =
    a.status === "requested"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-brand-200 bg-lime-100 text-brand-900";
  const ringTone =
    a.status === "requested" ? "ring-amber-300" : "ring-lime-500";

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 text-[11px] font-semibold ${tone}`}
      title={`${name} · ${a.status}`}
    >
      <Avatar
        url={a.umpire?.avatar_url ?? null}
        name={name}
        size={24}
        ring={ringTone}
      />
      {display}
    </span>
  );
}

function Avatar({
  url,
  name,
  size,
  ring,
}: {
  url: string | null;
  name: string;
  size: number;
  ring?: string;
}) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  const ringClass = ring ? `ring-2 ${ring}` : "";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${ringClass}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-200 text-[10px] font-bold text-brand-800 ${ringClass}`}
      style={{ width: size, height: size }}
    >
      {initial}
    </span>
  );
}

function GameAction({
  user,
  game,
  mine,
  remaining,
  conflicts,
  weekendSiblings,
  myAssignmentByGame,
  assignmentsByGame,
  assignmentOnly,
}: {
  user: { id: string; eligible_divisions?: string[] } | null;
  game: Game;
  mine: { id: string; status: Assignment["status"] } | undefined;
  remaining: number;
  conflicts: boolean;
  weekendSiblings: Game[];
  myAssignmentByGame: Map<string, AssignmentRowLite>;
  assignmentsByGame: Map<string, AssignmentRowLite[]>;
  assignmentOnly: boolean;
}) {
  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700"
      >
        Sign in
      </Link>
    );
  }

  const eligible = user.eligible_divisions?.includes(game.division_code) ?? true;

  if (assignmentOnly && !mine) {
    return (
      <span
        className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-600"
        title="Board assigns these games"
      >
        Board assigns
      </span>
    );
  }

  if (mine) {
    const label =
      mine.status === "requested"
        ? "Requested"
        : mine.status === "approved"
        ? "Approved"
        : mine.status === "confirmed"
        ? "Confirmed"
        : mine.status;
    const tone =
      mine.status === "requested"
        ? "bg-amber-100 text-amber-900"
        : "bg-lime-200 text-brand-900";
    return (
      <form action={cancelMyRequest} className="flex flex-col items-end gap-1">
        <span className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold ${tone}`}>
          {label}
        </span>
        <input type="hidden" name="assignmentId" value={mine.id} />
        <button
          type="submit"
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
        >
          Cancel
        </button>
      </form>
    );
  }

  if (remaining <= 0) {
    return (
      <span className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-500">
        Full
      </span>
    );
  }

  if (!eligible) {
    return (
      <Link
        href="/profile"
        className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-500"
        title={`Not eligible for ${game.division_code}. Update your profile.`}
      >
        Not eligible
      </Link>
    );
  }

  if (conflicts) {
    return (
      <span
        className="inline-flex h-9 items-center justify-center rounded-md bg-amber-50 px-3 text-xs font-medium text-amber-800"
        title="You're already on another game at this time"
      >
        Conflicts
      </span>
    );
  }

  // Weekend with siblings → inline opt-in popup
  if (weekendSiblings.length > 0) {
    return (
      <details className="text-xs">
        <summary className="cursor-pointer rounded-md bg-brand-600 px-3 py-2 text-center text-xs font-bold text-white transition-colors hover:bg-brand-700">
          Request…
        </summary>
        <form
          action={requestGameWithExtras}
          className="mt-2 w-56 rounded-md border border-zinc-200 bg-white p-3 text-left shadow-md"
        >
          <input type="hidden" name="gameId" value={game.id} />
          <p className="text-[11px] font-semibold text-zinc-700">
            You'll request this game.
          </p>
          <p className="mt-2 text-[11px] font-semibold text-zinc-700">
            Other {game.division_code} games at {game.field} that day — take any?
          </p>
          <ul className="mt-1 space-y-1.5">
            {weekendSiblings.map((s) => {
              const t = new Date(s.starts_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
                timeZone: "UTC",
              });
              const filled = (assignmentsByGame.get(s.id)?.length ?? 0);
              const isMine = !!myAssignmentByGame.get(s.id);
              const isFull = filled >= s.ump_slots;
              const disabled = isMine || isFull;
              return (
                <li key={s.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="extra"
                      value={s.id}
                      disabled={disabled}
                      className="h-3.5 w-3.5 accent-brand-600"
                    />
                    <span
                      className={`text-[11px] ${
                        disabled ? "text-zinc-400" : "text-zinc-800"
                      }`}
                    >
                      {t}
                      {isMine ? " (yours)" : isFull ? " (full)" : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="submit"
            className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
          >
            Send request
          </button>
        </form>
      </details>
    );
  }

  return (
    <form action={requestGame}>
      <input type="hidden" name="gameId" value={game.id} />
      <button
        type="submit"
        className="inline-flex h-9 items-center justify-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700"
      >
        Request
      </button>
    </form>
  );
}
