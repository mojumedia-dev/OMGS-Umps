"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import { logAudit } from "@/lib/audit/log";
import { refreshGameStatus } from "@/lib/db/game-status";
import { loadSlotGames } from "@/lib/db/slots";

async function requireBoardOrAdmin() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "board" && user.role !== "admin")
    throw new Error("Board access required");
  return user;
}

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

export async function assignUmpToGame(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  const umpireId = String(formData.get("umpireId") ?? "");
  if (!gameId || !umpireId) throw new Error("Pick an umpire");

  const board = await requireBoardOrAdmin();
  const sb = supabaseServer();

  // Scope check: board may only assign within their scope_divisions
  const { data: game } = await sb
    .from("games")
    .select("id, division_code, starts_at, ends_at, field, team_home, team_away")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (
    board.scope_divisions &&
    board.scope_divisions.length &&
    !board.scope_divisions.includes(game.division_code)
  ) {
    throw new Error(`You don't have scope for ${game.division_code}`);
  }

  // Time-conflict guard for the target ump
  const { data: theirActive } = await sb
    .from("assignments")
    .select("game:games(starts_at, ends_at)")
    .eq("umpire_id", umpireId)
    .in("status", ["requested", "assigned", "approved", "confirmed"]);
  type ActiveRow = { game: { starts_at: string; ends_at: string } | null };
  const slot = await loadSlotGames(game);
  for (const sg of slot) {
    for (const a of (theirActive ?? []) as unknown as ActiveRow[]) {
      if (!a.game) continue;
      if (sg.starts_at < a.game.ends_at && sg.ends_at > a.game.starts_at) {
        throw new Error("Ump already has a game at that time");
      }
    }
  }

  const inserts = slot.map((sg) => ({
    game_id: sg.id,
    umpire_id: umpireId,
    status: "assigned" as const,
    approved_by: board.id,
    approved_at: new Date().toISOString(),
  }));
  const { data: created, error } = await sb
    .from("assignments")
    .insert(inserts)
    .select("id, game_id");
  if (error) throw error;

  await sendPushToUser(umpireId, {
    title: `New assignment from ${board.full_name}`,
    body: formatGameSummary(game),
    url: "/dashboard",
    tag: `assigned-${gameId}`,
  });

  for (const a of created ?? []) {
    await logAudit({
      action: "approve",
      actorId: board.id,
      subjectId: umpireId,
      gameId: a.game_id,
      assignmentId: a.id,
      details: { board_assigned: true, bundle_size: slot.length },
    });
  }

  revalidatePath("/assign");
  revalidatePath("/dashboard");
  revalidatePath("/games");
}

export async function acceptAssignment(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();

  // Find assignment + slot mates so accept covers the whole bundle
  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, umpire_id, game_id, game:games(id, starts_at, ends_at, division_code, team_home, team_away, field)"
    )
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .eq("status", "assigned")
    .maybeSingle();
  if (!orig?.game) throw new Error("Assignment not found");

  const g = orig.game as unknown as {
    id: string;
    starts_at: string;
    ends_at: string;
    division_code: string;
    team_home: string;
    team_away: string;
    field: string;
  };
  const slot = await loadSlotGames(g);
  const slotIds = slot.map((sg) => sg.id);

  const { data: confirmed, error } = await sb
    .from("assignments")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("umpire_id", user.id)
    .eq("status", "assigned")
    .in("game_id", slotIds)
    .select("id, game_id");
  if (error) throw error;

  for (const a of confirmed ?? []) {
    await refreshGameStatus(a.game_id);
    await logAudit({
      action: "approve",
      actorId: user.id,
      subjectId: user.id,
      gameId: a.game_id,
      assignmentId: a.id,
      details: { ump_accepted: true },
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/assign");
  revalidatePath("/games");
}

export async function declineAssignment(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");

  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, umpire_id, game_id, approved_by, game:games(id, starts_at, ends_at, division_code, team_home, team_away, field)"
    )
    .eq("id", assignmentId)
    .eq("umpire_id", user.id)
    .eq("status", "assigned")
    .maybeSingle();
  if (!orig?.game) throw new Error("Assignment not found");

  const g = orig.game as unknown as {
    id: string;
    starts_at: string;
    ends_at: string;
    division_code: string;
    team_home: string;
    team_away: string;
    field: string;
  };
  const slot = await loadSlotGames(g);
  const slotIds = slot.map((sg) => sg.id);

  const { data: declined, error } = await sb
    .from("assignments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("umpire_id", user.id)
    .eq("status", "assigned")
    .in("game_id", slotIds)
    .select("id, game_id");
  if (error) throw error;

  for (const a of declined ?? []) await refreshGameStatus(a.game_id);

  // Notify the assigning board member so they can reassign
  if (orig.approved_by) {
    await sendPushToUser(orig.approved_by, {
      title: `${user.full_name} declined`,
      body: formatGameSummary(g),
      url: "/assign",
      tag: `decline-${assignmentId}`,
    });
  }
  for (const a of declined ?? []) {
    await logAudit({
      action: "decline",
      actorId: user.id,
      subjectId: user.id,
      gameId: a.game_id,
      assignmentId: a.id,
      details: { ump_declined_assignment: true },
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/assign");
  revalidatePath("/games");
}
