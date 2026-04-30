import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { cancelMyRequest } from "@/app/games/actions";
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

  const [{ data: rows, error }, openGamesRes, pendingApprovalsRes] = await Promise.all([
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
  ]);

  const openGamesCount = openGamesRes.count ?? 0;
  const pendingApprovalsCount = pendingApprovalsRes.count ?? 0;

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
                    return (
                      <li key={r.id} className="px-4 py-3">
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
                            <form action={cancelMyRequest}>
                              <input type="hidden" name="assignmentId" value={r.id} />
                              <button
                                type="submit"
                                className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
                              >
                                Cancel
                              </button>
                            </form>
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
