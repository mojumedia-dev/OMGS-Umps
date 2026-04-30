import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase/server";
import { ensureCurrentUserRow } from "@/lib/users";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
} from "@/lib/format";
import type { Game, Assignment } from "@/lib/db/types";
import { requestGame, cancelMyRequest } from "./actions";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES: Assignment["status"][] = [
  "requested",
  "approved",
  "confirmed",
  "completed",
  "paid",
];

export default async function GamesPage() {
  const { userId } = await auth();
  const user = userId ? await ensureCurrentUserRow() : null;

  const sb = supabaseServer();
  const nowIso = new Date().toISOString();

  const [{ data: gamesData, error: gamesErr }, { data: allActive, error: assnErr }] = await Promise.all([
    sb
      .from("games")
      .select("*")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(500),
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
  type AssignmentRow = Pick<Assignment, "id" | "game_id" | "umpire_id" | "status"> & {
    umpire: { full_name: string; avatar_url: string | null } | null;
  };
  const assignments = (allActive ?? []) as unknown as AssignmentRow[];

  const assignmentsByGame = new Map<string, AssignmentRow[]>();
  const myAssignmentByGame = new Map<string, AssignmentRow>();
  for (const a of assignments) {
    if (!assignmentsByGame.has(a.game_id)) assignmentsByGame.set(a.game_id, []);
    assignmentsByGame.get(a.game_id)!.push(a);
    if (user && a.umpire_id === user.id) myAssignmentByGame.set(a.game_id, a);
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              All games
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {games.length} upcoming · {grouped.size} game days
            </p>
          </div>
          <Link
            href={user ? "/dashboard" : "/"}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            ← {user ? "Dashboard" : "Home"}
          </Link>
        </div>

        {!user && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <Link href="/sign-in" className="font-medium text-amber-900 underline">
              Sign in
            </Link>{" "}
            <span className="text-amber-800">to request games.</span>
          </div>
        )}

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
                  const gameAssignments = assignmentsByGame.get(g.id) ?? [];
                  const filled = gameAssignments.length;
                  const remaining = g.ump_slots - filled;
                  const mine = myAssignmentByGame.get(g.id);
                  return (
                    <li key={g.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-5 items-center rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                              {g.division_code}
                            </span>
                            <span className="text-sm text-zinc-500">
                              {formatGameTime(g.starts_at)} · {g.field}
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
                          <div className="mt-1.5 text-xs text-zinc-500">
                            {formatMoney(g.pay_per_slot)}/ump
                          </div>
                        </div>
                        <div className="shrink-0">
                          <GameAction
                            user={user}
                            game={g}
                            mine={mine}
                            remaining={remaining}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </main>
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
}: {
  user: { id: string; eligible_divisions?: string[] } | null;
  game: Game;
  mine: { id: string; status: Assignment["status"] } | undefined;
  remaining: number;
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
