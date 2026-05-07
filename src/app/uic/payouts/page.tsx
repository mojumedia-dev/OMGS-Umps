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
import type { Game, User } from "@/lib/db/types";
import { markPaid, undoPaid, markBundlePaid } from "../actions";
import { LEAGUE_VENUE, LEAGUE_VENMO } from "@/lib/league";
import { buildVenmoPayUrl } from "@/lib/venmo";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: "approved" | "confirmed" | "completed" | "paid";
  paid_amount: number | null;
  paid_at: string | null;
  game: Game | null;
  umpire:
    | (Pick<User, "id" | "full_name" | "phone" | "avatar_url" | "venmo_handle">)
    | null;
};

function buildVenmoNote(rows: Row[]): string {
  // Compact memo: "OMGS ump 3 games: 5/10 14U F3 + 5/12 12U F1 + 5/14 8U F2"
  const parts = rows
    .map((r) => {
      const g = r.game!;
      const d = new Date(g.starts_at);
      const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      const f = g.field.replace(/^Field\s*/i, "F");
      return `${md} ${g.division_code} ${f}`;
    });
  const head = `OMGS ump ${rows.length} game${rows.length === 1 ? "" : "s"}: `;
  // Trim to ~200 chars to stay well under Venmo's limit.
  let memo = head + parts.join(" + ");
  if (memo.length > 200) memo = memo.slice(0, 197) + "…";
  return memo;
}

export default async function PayoutsPage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "board" && user.role !== "admin") redirect("/dashboard");
  const canEdit = user.role === "board" || user.role === "admin";

  const sb = supabaseServer();
  const nowIso = nowAsLeagueIso();

  let payoutQuery = sb
    .from("assignments")
    .select(
      `id, status, paid_amount, paid_at,
       game:games!inner (id, division_code, team_home, team_away, field, starts_at, ends_at, ump_slots, pay_per_slot, status),
       umpire:users!assignments_umpire_id_fkey (id, full_name, phone, avatar_url, venmo_handle)`
    )
    .in("status", ["approved", "confirmed", "completed", "paid"])
    .order("paid_at", { ascending: false, nullsFirst: true });
  if (user.scope_divisions && user.scope_divisions.length) {
    payoutQuery = payoutQuery.in("game.division_code", user.scope_divisions);
  }
  const { data: rows, error } = await payoutQuery;

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const all = (rows ?? []) as unknown as Row[];
  const eligible = all.filter((r) => r.game && r.game.starts_at <= nowIso);

  const unpaid = eligible.filter((r) => r.status !== "paid");
  const paid = eligible.filter((r) => r.status === "paid");

  // Group unpaid by umpire for bundled Venmo payouts
  const unpaidByUmp = new Map<string, Row[]>();
  for (const r of unpaid) {
    if (!r.umpire) continue;
    const list = unpaidByUmp.get(r.umpire.id) ?? [];
    list.push(r);
    unpaidByUmp.set(r.umpire.id, list);
  }
  const unpaidUmps = [...unpaidByUmp.entries()]
    .map(([umpId, items]) => ({
      ump: items[0].umpire!,
      items,
      total: items.reduce((s, r) => s + (r.game?.pay_per_slot ?? 0), 0),
      umpId,
    }))
    .sort((a, b) => b.total - a.total);

  // Paid history grouped by date (existing read pattern)
  const paidByDate = new Map<string, Row[]>();
  for (const r of paid) {
    const key = formatGameDateKey(r.game!.starts_at);
    if (!paidByDate.has(key)) paidByDate.set(key, []);
    paidByDate.get(key)!.push(r);
  }

  const unpaidTotal = unpaid.reduce((s, r) => s + (r.game?.pay_per_slot ?? 0), 0);
  const paidTotal = paid.reduce((s, r) => s + (r.paid_amount ?? 0), 0);

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

        <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          Paying from{" "}
          <a
            href={LEAGUE_VENMO.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-[#3D95CE] underline-offset-2 hover:underline"
          >
            @{LEAGUE_VENMO.handle}
          </a>
          . Make sure you&apos;re signed into that account in Venmo before tapping a Pay button.
        </div>

        {unpaidUmps.length === 0 && paid.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">
              No completed games yet. Come back after game time.
            </p>
          </div>
        ) : null}

        {unpaidUmps.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Owed — {unpaidUmps.length} ump{unpaidUmps.length === 1 ? "" : "s"}
            </h2>
            <ul className="space-y-3">
              {unpaidUmps.map(({ ump, items, total, umpId }) => {
                const venmoUrl = ump.venmo_handle
                  ? buildVenmoPayUrl({
                      handle: ump.venmo_handle,
                      amount: total,
                      note: buildVenmoNote(items),
                    })
                  : null;
                const divisionCounts = new Map<string, number>();
                for (const r of items) {
                  const d = r.game!.division_code;
                  divisionCounts.set(d, (divisionCounts.get(d) ?? 0) + 1);
                }
                return (
                  <li
                    key={umpId}
                    className="rounded-lg border border-zinc-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {ump.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ump.avatar_url}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                            {(ump.full_name ?? "U").trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">
                            {ump.full_name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {[...divisionCounts.entries()].map(([div, n]) => (
                              <span
                                key={div}
                                className="inline-flex h-5 items-center rounded bg-brand-50 px-1.5 text-[11px] font-bold text-brand-700"
                              >
                                {div} · {n}
                              </span>
                            ))}
                            <span className="inline-flex h-5 items-center text-[11px] font-medium text-zinc-500">
                              {items.length} game{items.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-zinc-500">Owed</div>
                        <div className="text-base font-bold text-zinc-900">
                          {formatMoney(total)}
                        </div>
                      </div>
                    </div>

                    {canEdit && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        {venmoUrl ? (
                          <a
                            href={venmoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-[#3D95CE] px-4 text-sm font-bold text-white transition-colors hover:bg-[#2c7caa]"
                          >
                            Pay {formatMoney(total)} via Venmo
                          </a>
                        ) : (
                          <span className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900">
                            No Venmo on file — pay manually
                          </span>
                        )}
                        <form action={markBundlePaid} className="flex-shrink-0">
                          <input
                            type="hidden"
                            name="umpireId"
                            value={umpId}
                          />
                          <button
                            type="submit"
                            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 transition-colors hover:bg-zinc-50 sm:w-auto"
                          >
                            Mark all paid
                          </button>
                        </form>
                      </div>
                    )}

                    {/* Per-game breakdown — collapsed by default to keep summary tight */}
                    <details className="mt-3 group">
                      <summary className="cursor-pointer text-xs font-semibold text-zinc-500 hover:text-zinc-700">
                        {items.length} game{items.length === 1 ? "" : "s"} —
                        breakdown
                      </summary>
                      <ul className="mt-2 divide-y divide-zinc-100 rounded-md border border-zinc-100">
                        {items.map((r) => {
                          const g = r.game!;
                          return (
                            <li
                              key={r.id}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span className="inline-flex h-4 items-center rounded bg-brand-600 px-1 text-[10px] font-bold text-white">
                                  {g.division_code}
                                </span>
                                <span className="text-zinc-600">
                                  {formatGameDate(g.starts_at)}{" "}
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
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold text-zinc-700">
                                  {formatMoney(g.pay_per_slot)}
                                </span>
                                {canEdit && (
                                  <form action={markPaid}>
                                    <input
                                      type="hidden"
                                      name="assignmentId"
                                      value={r.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="amount"
                                      value={g.pay_per_slot}
                                    />
                                    <button
                                      type="submit"
                                      className="text-[11px] font-semibold text-brand-700 underline-offset-2 hover:underline"
                                      title="Mark just this game paid"
                                    >
                                      Pay one
                                    </button>
                                  </form>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {paid.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Paid history
            </h2>
            <div className="space-y-6">
              {[...paidByDate.entries()].map(([dateKey, items]) => (
                <section key={dateKey}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {formatGameDate(items[0].game!.starts_at)}
                  </h3>
                  <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                    {items.map((r) => {
                      const g = r.game!;
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
                              {canEdit ? (
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
          </section>
        )}
      </div>
    </main>
  );
}
