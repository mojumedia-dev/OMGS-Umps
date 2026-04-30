import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
} from "@/lib/format";
import type { Game, User } from "@/lib/db/types";
import { markPaid, undoPaid } from "../actions";
import { LEAGUE_VENUE } from "@/lib/league";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: "approved" | "confirmed" | "completed" | "paid";
  paid_amount: number | null;
  paid_at: string | null;
  game: Game | null;
  umpire: Pick<User, "id" | "full_name" | "phone" | "avatar_url"> | null;
};

export default async function PayoutsPage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "board" && user.role !== "admin") redirect("/dashboard");
  const canEdit = user.role === "board" || user.role === "admin";

  const sb = supabaseServer();
  const nowIso = new Date().toISOString();

  // Eligible: games that have started and have assignments in approved/confirmed/completed/paid
  const { data: rows, error } = await sb
    .from("assignments")
    .select(
      `id, status, paid_amount, paid_at,
       game:games (id, division_code, team_home, team_away, field, starts_at, ends_at, ump_slots, pay_per_slot, status),
       umpire:users!assignments_umpire_id_fkey (id, full_name, phone, avatar_url)`
    )
    .in("status", ["approved", "confirmed", "completed", "paid"])
    .order("paid_at", { ascending: false, nullsFirst: true });

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const all = (rows ?? []) as unknown as Row[];
  // Only games that have already started
  const eligible = all.filter((r) => r.game && r.game.starts_at <= nowIso);

  const grouped = new Map<string, Row[]>();
  for (const r of eligible) {
    const key = formatGameDateKey(r.game!.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const unpaidTotal = eligible
    .filter((r) => r.status !== "paid")
    .reduce((s, r) => s + (r.game?.pay_per_slot ?? 0), 0);
  const paidTotal = eligible
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + (r.paid_amount ?? 0), 0);

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Payouts
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {formatMoney(unpaidTotal)} owed · {formatMoney(paidTotal)} paid
            </p>
          </div>
          <a
            href="/api/reports/payouts.csv"
            className="text-sm font-medium text-brand-700 hover:text-brand-900"
          >
            CSV ↓
          </a>
        </div>

        {eligible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">
              No completed games yet. Come back after game time.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([dateKey, items]) => (
              <section key={dateKey}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {formatGameDate(items[0].game!.starts_at)}
                </h2>
                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {items.map((r) => {
                    const g = r.game!;
                    const isPaid = r.status === "paid";
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
                            <div className="mt-1.5 flex items-center gap-2">
                              {r.umpire?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.umpire.avatar_url}
                                  alt=""
                                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                                />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                                  {(r.umpire?.full_name ?? "U").trim().charAt(0).toUpperCase()}
                                </span>
                              )}
                              <span className="truncate text-sm font-semibold">
                                {r.umpire?.full_name ?? "Unknown"}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0">
                            {isPaid ? (
                              canEdit ? (
                                <form
                                  action={undoPaid}
                                  className="flex items-center gap-2 text-right"
                                >
                                  <div>
                                    <div className="text-xs text-zinc-500">Paid</div>
                                    <div className="text-sm font-bold text-emerald-700">
                                      {formatMoney(r.paid_amount ?? 0)}
                                    </div>
                                  </div>
                                  <input
                                    type="hidden"
                                    name="assignmentId"
                                    value={r.id}
                                  />
                                  <button
                                    type="submit"
                                    className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                                    title="Undo payment"
                                  >
                                    Undo
                                  </button>
                                </form>
                              ) : (
                                <div className="text-right">
                                  <div className="text-xs text-zinc-500">Paid</div>
                                  <div className="text-sm font-bold text-emerald-700">
                                    {formatMoney(r.paid_amount ?? 0)}
                                  </div>
                                </div>
                              )
                            ) : canEdit ? (
                              <form
                                action={markPaid}
                                className="flex items-center gap-2"
                              >
                                <input
                                  type="hidden"
                                  name="assignmentId"
                                  value={r.id}
                                />
                                <input
                                  type="number"
                                  name="amount"
                                  defaultValue={g.pay_per_slot}
                                  step="1"
                                  min="0"
                                  className="h-9 w-20 rounded-md border border-zinc-300 px-2 text-right text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                                />
                                <button
                                  type="submit"
                                  className="inline-flex h-9 items-center justify-center rounded-md bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                                >
                                  Pay
                                </button>
                              </form>
                            ) : (
                              <div className="text-right">
                                <div className="text-xs text-zinc-500">Owed</div>
                                <div className="text-sm font-semibold text-zinc-900">
                                  {formatMoney(g.pay_per_slot)}
                                </div>
                              </div>
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
