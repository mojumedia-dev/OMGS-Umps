"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

async function requireUic() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "uic" && user.role !== "admin")
    throw new Error("UIC access required");
  return user;
}

async function refreshGameStatus(gameId: string) {
  const sb = supabaseServer();
  const [{ data: g }, { count }] = await Promise.all([
    sb.from("games").select("ump_slots, status").eq("id", gameId).single(),
    sb
      .from("assignments")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .in("status", ["approved", "confirmed", "completed", "paid"]),
  ]);
  if (!g) return;
  const filled = count ?? 0;
  let next = g.status;
  if (filled >= g.ump_slots) next = "filled";
  else if (filled > 0) next = "partial";
  else next = "open";
  if (next !== g.status) {
    await sb.from("games").update({ status: next }).eq("id", gameId);
  }
}

export async function approveRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const uic = await requireUic();

  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: uic.id,
    })
    .eq("id", assignmentId)
    .eq("status", "requested")
    .select("game_id")
    .single();
  if (error) throw error;
  if (a?.game_id) await refreshGameStatus(a.game_id);

  revalidatePath("/uic");
  revalidatePath("/games");
  revalidatePath("/dashboard");
}

export async function declineRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  await requireUic();

  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({ status: "declined" })
    .eq("id", assignmentId)
    .eq("status", "requested")
    .select("game_id")
    .single();
  if (error) throw error;
  if (a?.game_id) await refreshGameStatus(a.game_id);

  revalidatePath("/uic");
  revalidatePath("/games");
}
