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
  tournament_toggle: {
    label: "Tournament toggle",
    tone: "bg-brand-100 text-brand-900",
  },
  swap_propose: { label: "Swap proposed", tone: "bg-amber-100 text-amber-900" },
  swap_accept: { label: "Swap accepted", tone: "bg-lime-200 text-brand-900" },
  swap_decline: { label: "Swap declined", tone: "bg-red-100 text-red-900" },
  swap_cancel: { label: "Swap cancelled", tone: "bg-zinc-100 text-zinc-700" },
  swap_execute: { label: "Swap executed", tone: "bg-brand-200 text-brand-900" },
};

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

export default async function AuditPage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");
  if (
    user.role !== "uic" &&
    user.role !== "admin" &&
    user.role !== "board"
  )
    redirect("/dashboard");

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("audit_log")
    .select(
      `id, action, created_at, details,
       actor:users!audit_log_actor_id_fkey (full_name),
       subject:users!audit_log_subject_id_fkey (full_name),
       game:games (division_code, team_home, team_away, starts_at, field)`
    )
    .order("created_at", { ascending: false })
    .limit(200);

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
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Audit log
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Last {rows.length} events. Most recent first.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-700">No events yet.</p>
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
              const gameLabel = r.game
                ? `${r.game.division_code} ${r.game.team_home} vs ${r.game.team_away}`
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
                    <div className="mt-1 truncate text-xs text-zinc-600">
                      {gameLabel}
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
