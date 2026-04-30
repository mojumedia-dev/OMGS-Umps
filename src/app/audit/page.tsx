import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  request: { label: "Requested", tone: "bg-amber-100 text-amber-900" },
  cancel: { label: "Cancelled", tone: "bg-zinc-100 text-zinc-700" },
  approve: { label: "Approved", tone: "bg-lime-200 text-brand-900" },
  decline: { label: "Declined", tone: "bg-red-100 text-red-900" },
  pay: { label: "Paid", tone: "bg-emerald-100 text-emerald-900" },
  unpay: { label: "Unpaid", tone: "bg-orange-100 text-orange-900" },
  swap_propose: { label: "Swap proposed", tone: "bg-amber-100 text-amber-900" },
  swap_accept: { label: "Swap accepted", tone: "bg-lime-200 text-brand-900" },
  swap_decline: { label: "Swap declined", tone: "bg-red-100 text-red-900" },
  swap_cancel: { label: "Swap cancelled", tone: "bg-zinc-100 text-zinc-700" },
  swap_execute: { label: "Swap executed", tone: "bg-brand-200 text-brand-900" },
};

const FILTER_GROUPS: { label: string; actions: string[] }[] = [
  { label: "Requests", actions: ["request", "cancel"] },
  { label: "UIC", actions: ["approve", "decline"] },
  { label: "Pay", actions: ["pay", "unpay"] },
  {
    label: "Swaps",
    actions: ["swap_propose", "swap_accept", "swap_decline", "swap_cancel", "swap_execute"],
  },
];

type Row = {
  id: string;
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
  actor: { full_name: string | null } | null;
  subject: { full_name: string | null } | null;
  game: {
    division_code: string;
    team_home: string;
    team_away: string;
    starts_at: string;
    field: string;
  } | null;
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string; group?: string; from?: string; to?: string }>;
}) {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (user.role !== "uic" && user.role !== "admin" && user.role !== "board")
    redirect("/dashboard");

  const params = (await searchParams) ?? {};
  const action = params.action ?? "";
  const group = params.group ?? "";
  const from = params.from ?? "";
  const to = params.to ?? "";

  const sb = supabaseServer();
  let query = sb
    .from("audit_log")
    .select(
      `id, action, created_at, details,
       actor:users!audit_log_actor_id_fkey (full_name),
       subject:users!audit_log_subject_id_fkey (full_name),
       game:games (division_code, team_home, team_away, starts_at, field)`
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (action) {
    query = query.eq("action", action);
  } else if (group) {
    const g = FILTER_GROUPS.find((g) => g.label === group);
    if (g) query = query.in("action", g.actions);
  }
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);

  const { data, error } = await query;

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as Row[];

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Audit log
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {rows.length} event{rows.length === 1 ? "" : "s"} · most recent first
          </p>
        </div>

        <form
          method="GET"
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-4"
        >
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">Group</span>
            <select
              name="group"
              defaultValue={group}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            >
              <option value="">All groups</option>
              {FILTER_GROUPS.map((g) => (
                <option key={g.label} value={g.label}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">Action</span>
            <select
              name="action"
              defaultValue={action}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-700">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
            />
          </label>
          <div className="sm:col-span-4 flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-brand-600 px-4 text-xs font-bold text-white hover:bg-brand-700"
            >
              Apply
            </button>
            {(action || group || from || to) && (
              <a
                href="/audit"
                className="inline-flex h-9 items-center text-xs font-semibold text-zinc-600 underline-offset-2 hover:underline"
              >
                Clear
              </a>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">No events match the filters.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {rows.map((r) => {
              const meta = ACTION_LABELS[r.action] ?? {
                label: r.action,
                tone: "bg-zinc-100 text-zinc-700",
              };
              const when = new Date(r.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              });
              const gameDateLabel = r.game
                ? new Date(r.game.starts_at).toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                    timeZone: "UTC",
                  })
                : null;
              const gameLabel = r.game
                ? `${r.game.division_code} · ${r.game.team_home} vs ${r.game.team_away}`
                : null;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-bold ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                    <span className="font-semibold text-zinc-900">
                      {r.actor?.full_name ?? "(system)"}
                    </span>
                    {r.subject &&
                      r.subject.full_name &&
                      r.subject.full_name !== r.actor?.full_name && (
                        <span className="text-zinc-500">
                          → {r.subject.full_name}
                        </span>
                      )}
                    {r.details &&
                      typeof (r.details as { amount?: unknown }).amount ===
                        "number" && (
                        <span className="font-semibold text-emerald-700">
                          ${(r.details as { amount: number }).amount}
                        </span>
                      )}
                    <span className="ml-auto text-xs text-zinc-400">{when}</span>
                  </div>
                  {gameLabel && (
                    <div className="mt-1 text-xs text-zinc-600">
                      <span className="font-semibold text-zinc-700">
                        {gameDateLabel}
                      </span>{" "}
                      · <span className="truncate">{gameLabel}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
