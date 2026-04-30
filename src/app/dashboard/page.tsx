import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { cancelMyRequest } from "@/app/games/actions";
import { proposeSwap, acceptSwap, declineSwap, cancelSwap } from "./swap-actions";
import { LEAGUE_VENUE } from "@/lib/league";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
} from "@/lib/format";
import type { Game, Assignment } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");

  const sb = supabaseServer();
  const nowIso = new Date().toISOString();
  const isUic = user.role === "uic" || user.role === "admin";

  const [
    { data: rows, error },
    openGamesRes,
    pendingApprovalsRes,
    paidRes,
    incomingSwapsRes,
    umpRosterRes,
  ] = await Promise.all([
    sb
      .from("assignments")
      .select(
        `id, status, paid_amount,
         game:games (id, division_code, team_home, team_away, field,
                     starts_at, ends_at, ump_slots, pay_per_slot)`
      )
      .eq("umpire_id", user.id)
      .in("status", ["requested", "approved", "confirmed"])
      .order("game(starts_at)", { ascending: true }),
    sb
      .from("games")
      .select("*", { count: "exact", head: true })
      .eq("status", "open")
      .gte("starts_at", nowIso),
    isUic
      ? sb
          .from("assignments")
          .select("*", { count: "exact", head: true })
          .eq("status", "requested")
      : Promise.resolve({ count: 0 } as { count: number | null }),
    sb
      .from("assignments")
      .select("paid_amount, paid_at, game:games(starts_at, division_code)")
      .eq("umpire_id", user.id)
      .eq("status", "paid"),
    // Swaps targeted at me, awaiting my response
    sb
      .from("swap_requests")
      .select(
        `id, message, created_at,
         requester:assignments!swap_requests_assignment_id_fkey (
           umpire:users!assignments_umpire_id_fkey (id, full_name, avatar_url)
         ),
         assignment:assignments (
           id,
           game:games (id, division_code, team_home, team_away, field, starts_at, pay_per_slot)
         )`
      )
      .eq("target_umpire_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // Roster of all active umps for the swap target picker
    sb
      .from("users")
      .select("id, full_name, role")
      .eq("is_active", true)
      .neq("id", user.id)
      .order("full_name", { ascending: true }),
  ]);
  type PaidRow = {
    paid_amount: number | null;
    paid_at: string | null;
    game: { starts_at: string; division_code: string } | null;
  };
  const paidRows = (paidRes.data ?? []) as unknown as PaidRow[];
  const totalEarned = paidRows.reduce((s, r) => s + (r.paid_amount ?? 0), 0);

  // Group earnings by ISO Mon-Sun week (using the game date, not paid_at)
  function weekKey(iso: string): string {
    const d = new Date(iso);
    const dow = d.getUTCDay() || 7; // Mon=1..Sun=7
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    return d.toISOString().slice(0, 10);
  }
  const weekly = new Map<string, { count: number; total: number }>();
  for (const r of paidRows) {
    if (!r.game) continue;
    const k = weekKey(r.game.starts_at);
    const cur = weekly.get(k) ?? { count: 0, total: 0 };
    cur.count++;
    cur.total += r.paid_amount ?? 0;
    weekly.set(k, cur);
  }
  const weeklyEarnings = [...weekly.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8); // most recent 8 weeks
  const thisWeekKey = weekKey(nowIso);
  const thisWeekEarned = weekly.get(thisWeekKey)?.total ?? 0;

  const openGamesCount = openGamesRes.count ?? 0;
  const pendingApprovalsCount = pendingApprovalsRes.count ?? 0;

  // Outgoing pending swaps (proposed by me) — keyed by assignment id
  const myAssignmentIds = (
    ((rows ?? []) as Array<{ id: string }>) ?? []
  ).map((r) => r.id);
  const outgoingByAssignment = new Map<
    string,
    { id: string; target: { full_name: string | null } | null }
  >();
  if (myAssignmentIds.length) {
    const { data: outgoing } = await sb
      .from("swap_requests")
      .select(
        `id, assignment_id, status,
         target:users!swap_requests_target_umpire_id_fkey (id, full_name)`
      )
      .eq("status", "pending")
      .in("assignment_id", myAssignmentIds);
    for (const s of outgoing ?? []) {
      outgoingByAssignment.set(
        (s as { assignment_id: string }).assignment_id,
        s as unknown as {
          id: string;
          target: { full_name: string | null } | null;
        }
      );
    }
  }
  const umpRoster = (umpRosterRes.data ?? []) as Array<{
    id: string;
    full_name: string;
    role: string;
  }>;
  type IncomingSwap = {
    id: string;
    message: string | null;
    created_at: string;
    requester: {
      umpire: {
        id: string;
        full_name: string;
        avatar_url: string | null;
      } | null;
    } | null;
    assignment: {
      id: string;
      game: {
        id: string;
        division_code: string;
        team_home: string;
        team_away: string;
        field: string;
        starts_at: string;
        pay_per_slot: number;
      } | null;
    } | null;
  };
  const incomingSwaps = (incomingSwapsRes.data ?? []) as unknown as IncomingSwap[];

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  type Row = {
    id: string;
    status: Assignment["status"];
    paid_amount: number | null;
    game: Game | null;
  };
  const upcoming = ((rows ?? []) as unknown as Row[]).filter(
    (r) => r.game && r.game.starts_at >= nowIso
  );

  const grouped = new Map<string, Row[]>();
  for (const r of upcoming) {
    const key = formatGameDateKey(r.game!.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const requestedCount = upcoming.filter((r) => r.status === "requested").length;
  const lockedCount = upcoming.filter(
    (r) => r.status === "approved" || r.status === "confirmed"
  ).length;

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Hi, {user.full_name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {lockedCount} game{lockedCount === 1 ? "" : "s"} on the books
            {requestedCount > 0 ? ` · ${requestedCount} pending UIC` : ""}
            {thisWeekEarned > 0 ? ` · ${formatMoney(thisWeekEarned)} this week` : ""}
          </p>
          <Link
            href="/profile"
            className="mt-2 inline-block text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            Edit profile
          </Link>
        </div>

        <div className={`mb-8 grid gap-3 ${isUic ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <Link
            href="/games"
            className="group flex items-center justify-between rounded-xl bg-brand-600 px-4 py-4 text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <div>
              <div className="text-base font-bold">Browse games</div>
              <div className="mt-0.5 text-xs text-white/80">
                {openGamesCount} open
              </div>
            </div>
            <span className="text-xl transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>

          {isUic && (
            <Link
              href="/uic"
              className="group relative flex items-center justify-between rounded-xl bg-lime-400 px-4 py-4 text-brand-900 shadow-sm transition-colors hover:bg-lime-500"
            >
              <div>
                <div className="text-base font-bold">Pending approvals</div>
                <div className="mt-0.5 text-xs text-brand-900/80">
                  {pendingApprovalsCount} awaiting you
                </div>
              </div>
              {pendingApprovalsCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs font-bold text-white">
                  {pendingApprovalsCount}
                </span>
              )}
              <span className="text-xl transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          )}

          <Link
            href="#my-games"
            className="group flex items-center justify-between rounded-xl border-2 border-brand-200 bg-white px-4 py-4 text-brand-800 transition-colors hover:bg-brand-50"
          >
            <div>
              <div className="text-base font-bold">My games</div>
              <div className="mt-0.5 text-xs text-brand-700/70">
                {upcoming?.length ?? 0} upcoming
              </div>
            </div>
            <span className="text-xl transition-transform group-hover:translate-x-0.5">
              ↓
            </span>
          </Link>
        </div>

        {incomingSwaps.length > 0 && (
          <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-bold text-amber-900">
              Swap requests for you
            </h2>
            <ul className="mt-3 space-y-3">
              {incomingSwaps.map((s) => {
                const g = s.assignment?.game;
                const requester = s.requester?.umpire;
                if (!g || !requester) return null;
                return (
                  <li
                    key={s.id}
                    className="rounded-md border border-amber-200 bg-white p-3"
                  >
                    <div className="text-sm font-semibold">
                      {requester.full_name} → wants you to take their game
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      {g.division_code} ·{" "}
                      {new Date(g.starts_at).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                        timeZone: "UTC",
                      })}{" "}
                      · {g.field} · {formatMoney(g.pay_per_slot)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-700">
                      {g.team_home} vs {g.team_away}
                    </div>
                    {s.message && (
                      <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs italic text-amber-900">
                        &ldquo;{s.message}&rdquo;
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <form action={acceptSwap}>
                        <input type="hidden" name="swapId" value={s.id} />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center rounded-md bg-lime-400 px-3 text-xs font-bold text-brand-900 hover:bg-lime-500"
                        >
                          Accept
                        </button>
                      </form>
                      <form action={declineSwap}>
                        <input type="hidden" name="swapId" value={s.id} />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                        >
                          Decline
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {weeklyEarnings.length > 0 && (
          <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-brand-800">Earnings</h2>
              <div className="text-sm">
                <span className="font-bold text-emerald-700">
                  {formatMoney(totalEarned)}
                </span>
                <span className="ml-1 text-xs text-zinc-500">total</span>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-zinc-200">
              {weeklyEarnings.map(([key, w]) => {
                const start = new Date(key + "T00:00:00Z");
                const end = new Date(start);
                end.setUTCDate(end.getUTCDate() + 6);
                const fmt = (d: Date) =>
                  d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  });
                const isCurrent = key === thisWeekKey;
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-zinc-900">
                        Week of {fmt(start)} – {fmt(end)}
                        {isCurrent && (
                          <span className="ml-2 inline-flex h-5 items-center rounded-full bg-lime-200 px-2 text-[10px] font-bold uppercase text-brand-900">
                            this week
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {w.count} game{w.count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-emerald-700">
                      {formatMoney(w.total)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {upcoming.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">
              No games yet. Head to the schedule and request the ones you want.
            </p>
            <Link
              href="/games"
              className="mt-3 inline-flex text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline"
            >
              View all games →
            </Link>
          </div>
        ) : (
          <div id="my-games" className="space-y-6 scroll-mt-20">
            <h2 className="text-base font-semibold">Your upcoming games</h2>
            {[...grouped.entries()].map(([dateKey, items]) => (
              <section key={dateKey}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {formatGameDate(items[0].game!.starts_at)}
                </h3>
                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {items.map((r) => {
                    const g = r.game!;
                    const tone =
                      r.status === "requested"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-lime-200 text-brand-900";
                    const label =
                      r.status === "requested"
                        ? "Pending UIC"
                        : r.status === "approved"
                        ? "Approved"
                        : "Confirmed";
                    const outSwap = outgoingByAssignment.get(r.id);
                    const canSwap =
                      (r.status === "approved" || r.status === "confirmed") &&
                      !outSwap;
                    return (
                      <li key={r.id} className="px-4 py-3">
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
                            <div className="mt-1.5 text-xs text-zinc-500">
                              {formatMoney(g.pay_per_slot)} pay
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold ${tone}`}
                            >
                              {label}
                            </span>
                            {outSwap && (
                              <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2 text-[10px] font-semibold text-amber-900">
                                Swap → {outSwap.target?.full_name?.split(" ")[0] ?? ""}
                              </span>
                            )}
                            {r.status !== "requested" && (
                              <a
                                href={`/api/calendar/${r.id}`}
                                className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
                              >
                                Add to calendar
                              </a>
                            )}
                            {outSwap ? (
                              <form action={cancelSwap}>
                                <input type="hidden" name="swapId" value={outSwap.id} />
                                <button
                                  type="submit"
                                  className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                                >
                                  Cancel swap
                                </button>
                              </form>
                            ) : (
                              <>
                                {canSwap && (
                                  <details className="text-xs">
                                    <summary className="cursor-pointer font-semibold text-brand-700 underline-offset-2 hover:underline">
                                      Swap…
                                    </summary>
                                    <form
                                      action={proposeSwap}
                                      className="mt-2 flex flex-col items-end gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-2"
                                    >
                                      <input
                                        type="hidden"
                                        name="assignmentId"
                                        value={r.id}
                                      />
                                      <select
                                        name="targetUmpireId"
                                        required
                                        className="h-8 w-44 rounded-md border border-zinc-300 bg-white px-2 text-xs"
                                        defaultValue=""
                                      >
                                        <option value="" disabled>
                                          Pick an ump
                                        </option>
                                        {umpRoster.map((u) => (
                                          <option key={u.id} value={u.id}>
                                            {u.full_name}
                                            {u.role !== "umpire"
                                              ? ` (${u.role})`
                                              : ""}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        name="message"
                                        placeholder="Optional note"
                                        maxLength={500}
                                        className="h-8 w-44 rounded-md border border-zinc-300 px-2 text-xs"
                                      />
                                      <button
                                        type="submit"
                                        className="inline-flex h-8 items-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
                                      >
                                        Send swap
                                      </button>
                                    </form>
                                  </details>
                                )}
                                <form action={cancelMyRequest}>
                                  <input type="hidden" name="assignmentId" value={r.id} />
                                  <button
                                    type="submit"
                                    className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
                                  >
                                    Cancel
                                  </button>
                                </form>
                              </>
                            )}
                          </div>
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
