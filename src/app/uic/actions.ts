"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshGameStatus } from "@/lib/db/game-status";

async function requireUic() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "uic" && user.role !== "admin")
    throw new Error("UIC access required");
  return user;
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
