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
import { approveRequest, declineRequest } from "./actions";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  requested_at: string;
  game: Game | null;
  umpire: Pick<User, "id" | "full_name" | "email" | "phone"> | null;
};

export default async function UicQueuePage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "uic" && user.role !== "admin") {
    return (
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center">
          <h1 className="text-lg font-bold">UIC access required</h1>
          <p className="mt-2 text-sm text-zinc-600">
            This area is for the Umpire-in-Charge. Ask an admin if you need
            access.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const sb = supabaseServer();
  const { data: rows, error } = await sb
    .from("assignments")
    .select(
      `id, requested_at,
       game:games (id, division_code, team_home, team_away, field,
                   starts_at, ends_at, ump_slots, pay_per_slot, status),
       umpire:users (id, full_name, email, phone)`
    )
    .eq("status", "requested")
    .order("requested_at", { ascending: true });

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const requests = (rows ?? []) as unknown as RequestRow[];
  const grouped = new Map<string, RequestRow[]>();
  for (const r of requests) {
    if (!r.game) continue;
    const key = formatGameDateKey(r.game.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Pending requests
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {requests.length} awaiting your review
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            ← Dashboard
          </Link>
        </div>

        {requests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">No pending requests. Inbox zero.</p>
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
                    return (
                      <li key={r.id} className="px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-5 items-center rounded bg-zinc-900 px-1.5 text-[11px] font-bold text-white">
                                {g.division_code}
                              </span>
                              <span className="text-sm text-zinc-500">
                                {formatGameTime(g.starts_at)} · {g.field}
                              </span>
                              <span className="text-xs text-zinc-400">
                                {formatMoney(g.pay_per_slot)}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-sm font-medium text-zinc-900">
                              {g.team_home} vs {g.team_away}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm">
                              <span className="font-semibold text-zinc-900">
                                {r.umpire?.full_name ?? "Unknown ump"}
                              </span>
                              {r.umpire?.phone && (
                                <span className="text-xs text-zinc-500">
                                  {r.umpire.phone}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <form action={approveRequest}>
                              <input type="hidden" name="assignmentId" value={r.id} />
                              <button
                                type="submit"
                                className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                            </form>
                            <form action={declineRequest}>
                              <input type="hidden" name="assignmentId" value={r.id} />
                              <button
                                type="submit"
                                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100"
                              >
                                Decline
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
