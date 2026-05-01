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
import { LEAGUE_VENUE } from "@/lib/league";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  requested_at: string;
  game: Game | null;
  umpire: Pick<User, "id" | "full_name" | "email" | "phone" | "avatar_url"> | null;
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
       umpire:users!assignments_umpire_id_fkey (id, full_name, email, phone, avatar_url)`
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

  const allRequests = (rows ?? []) as unknown as RequestRow[];

  // Group requests by slot (same ump + date + field + division) so a bundle
  // appears as ONE card listing every game in it. Approving any one cascades
  // through the whole slot via the slot logic in the action.
  type Bundle = {
    primary: RequestRow;
    games: NonNullable<RequestRow["game"]>[];
    requested_at: string;
  };
  const slotMap = new Map<string, Bundle>();
  for (const r of allRequests) {
    if (!r.game || !r.umpire) continue;
    const key = `${r.umpire.id}_${r.game.starts_at.slice(0, 10)}_${r.game.field}_${r.game.division_code}`;
    const existing = slotMap.get(key);
    if (!existing) {
      slotMap.set(key, {
        primary: r,
        games: [r.game],
        requested_at: r.requested_at,
      });
    } else {
      existing.games.push(r.game);
      // Keep the earliest game's assignment as the action target
      if (r.game.starts_at < (existing.primary.game?.starts_at ?? "")) {
        existing.primary = r;
      }
      if (r.requested_at < existing.requested_at) {
        existing.requested_at = r.requested_at;
      }
    }
  }
  // Sort each bundle's games by start time
  for (const b of slotMap.values()) {
    b.games.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  }
  const bundles = [...slotMap.values()].sort((a, b) =>
    a.requested_at < b.requested_at ? -1 : 1
  );

  const grouped = new Map<string, Bundle[]>();
  for (const b of bundles) {
    if (!b.primary.game) continue;
    const key = formatGameDateKey(b.primary.game.starts_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(b);
  }

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Pending requests
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {bundles.length} awaiting your review
            {allRequests.length > bundles.length
              ? ` (${allRequests.length} games bundled)`
              : ""}
          </p>
        </div>

        {bundles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">No pending requests. Inbox zero.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([dateKey, items]) => (
              <section key={dateKey}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {formatGameDate(items[0].games[0].starts_at)}
                </h2>
                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {items.map((b) => {
                    const r = b.primary;
                    const firstGame = b.games[0];
                    const isBundle = b.games.length > 1;
                    return (
                      <li key={r.id} className="px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-5 items-center rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                                {firstGame.division_code}
                              </span>
                              <a
                                href={LEAGUE_VENUE.mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-brand-700 underline-offset-2 hover:underline"
                                title={LEAGUE_VENUE.address}
                              >
                                {firstGame.field}
                              </a>
                              <span className="text-xs text-zinc-400">
                                {formatMoney(firstGame.pay_per_slot)}/ump
                              </span>
                              {isBundle && (
                                <span className="inline-flex h-5 items-center rounded-full bg-brand-100 px-2 text-[10px] font-bold text-brand-800">
                                  Bundle: {b.games.length} games
                                </span>
                              )}
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {b.games.map((g) => (
                                <li
                                  key={g.id}
                                  className="text-sm text-zinc-900"
                                >
                                  <span className="inline-block w-16 font-mono text-xs text-zinc-500">
                                    {formatGameTime(g.starts_at)}
                                  </span>
                                  <span className="font-medium">
                                    {g.team_home}
                                  </span>{" "}
                                  <span className="text-zinc-600">
                                    vs {g.team_away}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-2 flex items-center gap-2.5 text-sm">
                              {r.umpire?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.umpire.avatar_url}
                                  alt=""
                                  className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-brand-200"
                                />
                              ) : (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 ring-2 ring-brand-200">
                                  {(r.umpire?.full_name ?? "U").trim().charAt(0).toUpperCase()}
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-zinc-900">
                                  {r.umpire?.full_name ?? "Unknown ump"}
                                </div>
                                {r.umpire?.phone && (
                                  <div className="text-xs text-zinc-500">
                                    {r.umpire.phone}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <form action={approveRequest}>
                              <input type="hidden" name="assignmentId" value={r.id} />
                              <button
                                type="submit"
                                className="inline-flex h-9 items-center justify-center rounded-md bg-lime-400 px-3 text-xs font-bold text-brand-900 transition-colors hover:bg-lime-500"
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
