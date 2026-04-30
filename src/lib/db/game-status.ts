import { supabaseServer } from "@/lib/supabase/server";
import type { GameStatus } from "@/lib/db/types";

const FILLED_STATUSES = ["approved", "confirmed", "completed", "paid"] as const;

/**
 * Recompute games.status from the count of active assignments. Called after
 * any approve/decline/cancel so the games board reflects reality.
 *   0 active           → 'open'
 *   0 < active < slots → 'partial'
 *   active >= slots    → 'filled'
 * Leaves 'cancelled' / 'completed' alone.
 */
export async function refreshGameStatus(gameId: string): Promise<void> {
  const sb = supabaseServer();
  const [{ data: g }, { count }] = await Promise.all([
    sb.from("games").select("ump_slots, status").eq("id", gameId).single(),
    sb
      .from("assignments")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .in("status", FILLED_STATUSES as unknown as string[]),
  ]);
  if (!g) return;
  if (g.status === "cancelled" || g.status === "completed") return;

  const filled = count ?? 0;
  let next: GameStatus = "open";
  if (filled >= g.ump_slots) next = "filled";
  else if (filled > 0) next = "partial";

  if (next !== g.status) {
    await sb.from("games").update({ status: next }).eq("id", gameId);
  }
}
