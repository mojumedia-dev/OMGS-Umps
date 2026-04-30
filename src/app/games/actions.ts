"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshGameStatus } from "@/lib/db/game-status";
import { logAudit } from "@/lib/audit/log";

export async function requestGame(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) throw new Error("Missing gameId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  const { data: game } = await sb
    .from("games")
    .select("id, ump_slots, status, division_code")
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

  const { data: created, error } = await sb
    .from("assignments")
    .insert({
      game_id: gameId,
      umpire_id: user.id,
      status: "requested",
    })
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") throw error; // ignore duplicate request

  if (created?.id) {
    await logAudit({
      action: "request",
      actorId: user.id,
      subjectId: user.id,
      gameId,
      assignmentId: created.id,
    });
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
  const { data: a, error } = await sb
    .from("assignments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"])
    .select("game_id")
    .maybeSingle();
  if (error) throw error;
  if (a?.game_id) await refreshGameStatus(a.game_id);

  if (a) {
    await logAudit({
      action: "cancel",
      actorId: user.id,
      subjectId: user.id,
      gameId: a.game_id,
      assignmentId,
    });
  }

  revalidatePath("/games");
  revalidatePath("/dashboard");
  revalidatePath("/uic");
}
