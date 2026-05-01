import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export interface SlotGame {
  id: string;
  starts_at: string;
  ends_at: string;
  division_code: string;
  field: string;
}

/**
 * A "slot" is the unit an umpire commits to. On weekdays, a slot bundles every
 * game with the same date + field + division — taking one means taking all.
 * On weekends, each game is its own singleton slot.
 */
export function isWeekday(starts_at: string): boolean {
  const d = new Date(starts_at);
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

export function dayWindow(starts_at: string): { from: string; to: string } {
  const d = new Date(starts_at);
  const dayStart = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { from: dayStart.toISOString(), to: dayEnd.toISOString() };
}

export function slotKey(g: Pick<SlotGame, "starts_at" | "field" | "division_code">): string {
  return `${g.starts_at.slice(0, 10)}_${g.field}_${g.division_code}`;
}

/**
 * For a game, return all games in its slot. On weekend a slot is just the one
 * game. On weekday, all same-date+field+division games are bundled.
 */
export async function loadSlotGames(game: SlotGame): Promise<SlotGame[]> {
  if (!isWeekday(game.starts_at)) return [game];
  const win = dayWindow(game.starts_at);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("games")
    .select("id, starts_at, ends_at, division_code, field")
    .eq("field", game.field)
    .eq("division_code", game.division_code)
    .gte("starts_at", win.from)
    .lt("starts_at", win.to)
    .order("starts_at", { ascending: true });
  if (error || !data || data.length === 0) return [game];
  return data as SlotGame[];
}
