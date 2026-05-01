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
 * Return all games in the slot — same-date+field+division. Used for both
 * weekday auto-bundle (request creates assignments for every slot game) and
 * cascade operations (cancel/approve/decline always sweep the slot for the
 * SAME ump). The weekday-vs-weekend difference lives in the request flow
 * itself, not here.
 */
export async function loadSlotGames(game: SlotGame): Promise<SlotGame[]> {
  return loadSameDayFieldDivision(game);
}

/**
 * Always return same-date+field+division games, regardless of weekday/weekend.
 * Used by the weekend opt-in picker.
 */
export async function loadSameDayFieldDivision(
  game: SlotGame
): Promise<SlotGame[]> {
  const win = dayWindow(game.starts_at);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("games")
    .select("id, starts_at, ends_at, division_code, field, team_home, team_away")
    .eq("field", game.field)
    .eq("division_code", game.division_code)
    .gte("starts_at", win.from)
    .lt("starts_at", win.to)
    .order("starts_at", { ascending: true });
  if (error || !data || data.length === 0) return [game];
  return data as unknown as SlotGame[];
}
