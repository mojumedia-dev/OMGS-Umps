"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

export async function requestGame(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) throw new Error("Missing gameId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  const { data: game } = await sb
    .from("games")
    .select("id, ump_slots, status")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.status === "filled" || game.status === "cancelled")
    throw new Error("Game not available");

  const { error } = await sb.from("assignments").insert({
    game_id: gameId,
    umpire_id: user.id,
    status: "requested",
  });
  if (error && error.code !== "23505") throw error; // ignore duplicate request

  revalidatePath("/games");
  revalidatePath("/dashboard");
}

export async function cancelMyRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  const { error } = await sb
    .from("assignments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .in("status", ["requested", "approved", "confirmed"]);
  if (error) throw error;

  revalidatePath("/games");
  revalidatePath("/dashboard");
}
