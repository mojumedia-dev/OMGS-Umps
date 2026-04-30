import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import {
  formatGameDate,
  formatGameTime,
  formatGameDateKey,
  formatMoney,
} from "@/lib/format";
import type { Game } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("games")
    .select("*")
    .order("starts_at", { ascending: true })
    .limit(500);

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load games: {error.message}</p>
      </main>
    );
  }

  const games = (data ?? []) as Game[];
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
              Schedule
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {games.length} games · {grouped.size} game days
            </p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            ← Home
          </Link>
        </div>

        <div className="space-y-6">
          {[...grouped.entries()].map(([dateKey, dayGames]) => (
            <section key={dateKey}>
              <h2 className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-zinc-600 backdrop-blur sm:mx-0 sm:px-0">
                {formatGameDate(dayGames[0].starts_at)}
              </h2>
              <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {dayGames.map((g) => (
                  <li key={g.id} className="px-4 py-3">
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
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs uppercase tracking-wide text-zinc-500">
                          Pay
                        </div>
                        <div className="text-sm font-semibold text-zinc-900">
                          {formatMoney(g.pay_per_slot)}
                          {g.ump_slots > 1 ? ` × ${g.ump_slots}` : ""}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
