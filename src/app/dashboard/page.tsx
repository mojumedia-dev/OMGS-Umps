import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
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

  const { data: rows, error } = await sb
    .from("assignments")
    .select(
      `id, status, paid_amount,
       game:games (id, division_code, team_home, team_away, field,
                   starts_at, ends_at, ump_slots, pay_per_slot)`
    )
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"])
    .order("game(starts_at)", { ascending: true });

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
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href="/games"
            className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
          >
            Browse open games
          </Link>
          {(user.role === "uic" || user.role === "admin") && (
            <Link
              href="/uic"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
            >
              UIC approvals
            </Link>
          )}
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
              View open games →
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
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
                        : "bg-emerald-100 text-emerald-900";
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
                              <span className="inline-flex h-5 items-center rounded bg-zinc-900 px-1.5 text-[11px] font-bold text-white">
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
                          <span
                            className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold ${tone}`}
                          >
                            {label}
                          </span>
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
