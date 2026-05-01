"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshGameStatus } from "@/lib/db/game-status";
import { logAudit } from "@/lib/audit/log";
import { loadSlotGames } from "@/lib/db/slots";

async function tryRequestGameId(
  sb: ReturnType<typeof supabaseServer>,
  user: { id: string; eligible_divisions: string[] | null },
  activeRows: { id: string; game: { starts_at: string; ends_at: string } | null }[],
  gameId: string
): Promise<string | null> {
  const { data: g } = await sb
    .from("games")
    .select("id, status, division_code, starts_at, ends_at")
    .eq("id", gameId)
    .single();
  if (!g) return null;
  if (g.status === "filled" || g.status === "cancelled") return null;
  if (!user.eligible_divisions?.includes(g.division_code)) return null;
  for (const a of activeRows) {
    if (!a.game) continue;
    if (g.starts_at < a.game.ends_at && g.ends_at > a.game.starts_at) return null;
  }
  const { data: created, error } = await sb
    .from("assignments")
    .insert({ game_id: gameId, umpire_id: user.id, status: "requested" })
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") return null;
  return created?.id ?? null;
}

export async function requestGame(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) throw new Error("Missing gameId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  const { data: game } = await sb
    .from("games")
    .select("id, ump_slots, status, division_code, starts_at, ends_at, field")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.status === "filled" || game.status === "cancelled")
    throw new Error("Game not available");
  if (!user.eligible_divisions?.includes(game.division_code)) {
    throw new Error(
      `You're not eligible for ${game.division_code}. Update your profile to add it.`
    );
  }
  // Assignment-only divisions: only board can place umps (8U)
  const { data: divRow } = await sb
    .from("divisions")
    .select("assignment_only")
    .eq("code", game.division_code)
    .maybeSingle();
  if (divRow?.assignment_only) {
    throw new Error(
      `${game.division_code} games are assigned by the board, not requested.`
    );
  }

  // Bundle: weekday games auto-include same-date+field+division siblings
  const slot = await loadSlotGames(game);

  // Time-conflict guard: ump can't double-book themselves on any slot game
  const { data: myActive } = await sb
    .from("assignments")
    .select("id, game:games(starts_at, ends_at)")
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"]);
  type ActiveRow = { id: string; game: { starts_at: string; ends_at: string } | null };
  const activeRows = (myActive ?? []) as unknown as ActiveRow[];
  for (const sg of slot) {
    for (const a of activeRows) {
      if (!a.game) continue;
      const conflicts =
        sg.starts_at < a.game.ends_at && sg.ends_at > a.game.starts_at;
      if (conflicts) {
        throw new Error("That overlaps another game you're already on");
      }
    }
  }

  // Create assignments for every game in the slot
  const inserts = slot.map((sg) => ({
    game_id: sg.id,
    umpire_id: user.id,
    status: "requested" as const,
  }));
  const { data: created, error } = await sb
    .from("assignments")
    .insert(inserts)
    .select("id, game_id");
  if (error && error.code !== "23505") throw error;

  // One audit entry per request action, not per game in the bundle
  const primary = (created ?? [])[0];
  if (primary) {
    await logAudit({
      action: "request",
      actorId: user.id,
      subjectId: user.id,
      gameId: primary.game_id,
      assignmentId: primary.id,
      details: slot.length > 1 ? { bundle_size: slot.length } : undefined,
    });
  }

  revalidatePath("/games");
  revalidatePath("/dashboard");
}

/**
 * Weekend opt-in: ump requests the primary game plus any same-day+field+division
 * "extras" they checked in the popup. Skips invalid extras silently rather than
 * failing the whole transaction (best-effort multi-insert).
 */
export async function requestGameWithExtras(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) throw new Error("Missing gameId");
  const extras = formData.getAll("extra").map(String).filter(Boolean);

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  // Reuse the existing flow for the primary game (does its own bundle if weekday)
  const fakeForm = new FormData();
  fakeForm.set("gameId", gameId);
  await requestGame(fakeForm);

  // Best-effort: request each extra
  const { data: myActive } = await sb
    .from("assignments")
    .select("id, game:games(starts_at, ends_at)")
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"]);
  type ActiveRow = { id: string; game: { starts_at: string; ends_at: string } | null };
  const activeRows = (myActive ?? []) as unknown as ActiveRow[];

  for (const extraId of extras) {
    if (extraId === gameId) continue;
    const created = await tryRequestGameId(sb, user, activeRows, extraId);
    if (created) {
      await logAudit({
        action: "request",
        actorId: user.id,
        subjectId: user.id,
        gameId: extraId,
        assignmentId: created,
        details: { weekend_extra: true },
      });
    }
  }

  revalidatePath("/games");
  revalidatePath("/dashboard");
}

export async function cancelMyRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  // Find the original assignment so we can identify its slot
  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, game:games(id, starts_at, ends_at, division_code, field)"
    )
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"])
    .maybeSingle();
  if (!orig?.game) return;

  const slot = await loadSlotGames(
    orig.game as unknown as {
      id: string;
      starts_at: string;
      ends_at: string;
      division_code: string;
      field: string;
    }
  );
  const slotIds = slot.map((g) => g.id);

  const { data: cancelled, error } = await sb
    .from("assignments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"])
    .in("game_id", slotIds)
    .select("id, game_id");
  if (error) throw error;

  const cancelledList = cancelled ?? [];
  for (const a of cancelledList) await refreshGameStatus(a.game_id);
  const primaryCancel = cancelledList[0];
  if (primaryCancel) {
    await logAudit({
      action: "cancel",
      actorId: user.id,
      subjectId: user.id,
      gameId: primaryCancel.game_id,
      assignmentId: primaryCancel.id,
      details:
        cancelledList.length > 1
          ? { bundle_size: cancelledList.length }
          : undefined,
    });
  }

  revalidatePath("/games");
  revalidatePath("/dashboard");
  revalidatePath("/uic");
}
