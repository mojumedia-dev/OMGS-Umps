"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import { logAudit } from "@/lib/audit/log";

function formatGameSummary(g: {
  division_code: string;
  team_home: string;
  starts_at: string;
  field: string;
}): string {
  const d = new Date(g.starts_at);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
  return `${g.division_code} · ${day} ${time} · ${g.field}`;
}

type GameLite = {
  division_code: string;
  team_home: string;
  team_away: string;
  field: string;
  starts_at: string;
};

export async function proposeSwap(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const targetUmpireId = String(formData.get("targetUmpireId") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 500);
  if (!assignmentId || !targetUmpireId) throw new Error("Pick a target umpire");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (targetUmpireId === user.id) throw new Error("Can't swap with yourself");

  const sb = supabaseServer();

  const { data: a } = await sb
    .from("assignments")
    .select(
      `id, umpire_id, game_id, status,
       game:games(division_code, team_home, team_away, field, starts_at)`
    )
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .in("status", ["approved", "confirmed"])
    .maybeSingle();
  if (!a) throw new Error("Assignment not found or not eligible");

  // Cancel any prior pending swap on this assignment
  await sb
    .from("swap_requests")
    .update({ status: "cancelled" })
    .eq("assignment_id", assignmentId)
    .eq("status", "pending");

  const { data: swap, error } = await sb
    .from("swap_requests")
    .insert({
      assignment_id: assignmentId,
      target_umpire_id: targetUmpireId,
      message: message || null,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (a.game) {
    const g = a.game as unknown as GameLite;
    await sendPushToUser(targetUmpireId, {
      title: `${user.full_name} wants to swap`,
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `swap-${swap.id}`,
    });
  }

  await logAudit({
    action: "swap_propose",
    actorId: user.id,
    subjectId: targetUmpireId,
    gameId: a.game_id,
    assignmentId,
    swapRequestId: swap.id,
    details: message ? { message } : undefined,
  });

  revalidatePath("/dashboard");
}

export async function acceptSwap(formData: FormData): Promise<void> {
  const swapId = String(formData.get("swapId") ?? "");
  if (!swapId) throw new Error("Missing swapId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  const { data: swap } = await sb
    .from("swap_requests")
    .select(
      `id, assignment_id, target_umpire_id, status,
       assignment:assignments(
         id, umpire_id, game_id, status,
         game:games(division_code, team_home, team_away, field, starts_at)
       )`
    )
    .eq("id", swapId)
    .eq("status", "pending")
    .maybeSingle();
  if (!swap) throw new Error("Swap not found");
  if (swap.target_umpire_id !== user.id)
    throw new Error("This swap isn't for you");

  const a = swap.assignment as unknown as {
    id: string;
    umpire_id: string;
    game_id: string;
    status: string;
    game: GameLite | null;
  } | null;
  if (!a) throw new Error("Assignment missing");

  const fromUmpId = a.umpire_id;

  // Flip the assignment to the target
  const { error: updateErr } = await sb
    .from("assignments")
    .update({ umpire_id: user.id })
    .eq("id", swap.assignment_id);
  if (updateErr) throw updateErr;

  // Mark swap approved (auto-approve flow for MVP)
  await sb
    .from("swap_requests")
    .update({
      status: "approved",
      responded_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq("id", swapId);

  if (a.game) {
    const g = a.game;
    await sendPushToUser(fromUmpId, {
      title: `${user.full_name} accepted the swap ✅`,
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `swap-${swapId}`,
    });
  }

  await logAudit({
    action: "swap_accept",
    actorId: user.id,
    subjectId: fromUmpId,
    gameId: a.game_id,
    assignmentId: swap.assignment_id,
    swapRequestId: swapId,
  });
  await logAudit({
    action: "swap_execute",
    actorId: user.id,
    subjectId: fromUmpId,
    gameId: a.game_id,
    assignmentId: swap.assignment_id,
    swapRequestId: swapId,
    details: { from: fromUmpId, to: user.id },
  });

  revalidatePath("/dashboard");
  revalidatePath("/games");
  revalidatePath("/uic");
}

export async function declineSwap(formData: FormData): Promise<void> {
  const swapId = String(formData.get("swapId") ?? "");
  if (!swapId) throw new Error("Missing swapId");
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  const { data: swap } = await sb
    .from("swap_requests")
    .select(
      `id, assignment_id, target_umpire_id,
       assignment:assignments(umpire_id, game_id,
         game:games(division_code, team_home, team_away, field, starts_at))`
    )
    .eq("id", swapId)
    .eq("status", "pending")
    .maybeSingle();
  if (!swap) throw new Error("Swap not found");
  if (swap.target_umpire_id !== user.id)
    throw new Error("This swap isn't for you");

  await sb
    .from("swap_requests")
    .update({ status: "rejected", responded_at: new Date().toISOString() })
    .eq("id", swapId);

  const a = swap.assignment as unknown as {
    umpire_id: string;
    game_id: string;
    game: GameLite | null;
  } | null;
  if (a?.game) {
    await sendPushToUser(a.umpire_id, {
      title: `${user.full_name} declined the swap`,
      body: formatGameSummary(a.game),
      url: "/dashboard",
      tag: `swap-${swapId}`,
    });
  }
  await logAudit({
    action: "swap_decline",
    actorId: user.id,
    subjectId: a?.umpire_id ?? null,
    gameId: a?.game_id ?? null,
    assignmentId: swap.assignment_id,
    swapRequestId: swapId,
  });

  revalidatePath("/dashboard");
}

export async function cancelSwap(formData: FormData): Promise<void> {
  const swapId = String(formData.get("swapId") ?? "");
  if (!swapId) throw new Error("Missing swapId");
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  const { data: swap } = await sb
    .from("swap_requests")
    .select(
      "id, assignment_id, target_umpire_id, assignment:assignments(umpire_id, game_id)"
    )
    .eq("id", swapId)
    .eq("status", "pending")
    .maybeSingle();
  if (!swap) throw new Error("Swap not found");

  const a = swap.assignment as unknown as { umpire_id: string; game_id: string } | null;
  if (!a || a.umpire_id !== user.id)
    throw new Error("Only the requester can cancel");

  await sb
    .from("swap_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("id", swapId);

  await logAudit({
    action: "swap_cancel",
    actorId: user.id,
    subjectId: swap.target_umpire_id ?? null,
    gameId: a.game_id,
    assignmentId: swap.assignment_id,
    swapRequestId: swapId,
  });

  revalidatePath("/dashboard");
}
