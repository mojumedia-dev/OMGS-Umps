"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshGameStatus } from "@/lib/db/game-status";
import { sendPushToUser } from "@/lib/push/send";
import { logAudit } from "@/lib/audit/log";
import { loadSlotGames } from "@/lib/db/slots";

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

async function requireUic() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "uic" && user.role !== "admin")
    throw new Error("UIC access required");
  return user;
}

async function requireBoard() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "board" && user.role !== "admin")
    throw new Error("Board access required");
  return user;
}

export async function approveRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const uic = await requireUic();

  const sb = supabaseServer();

  // Load the original assignment + game to identify the slot
  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, umpire_id, game_id, game:games(id, starts_at, ends_at, division_code, team_home, team_away, field)"
    )
    .eq("id", assignmentId)
    .eq("status", "requested")
    .maybeSingle();
  if (!orig?.game) return;

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

  // Approve every requested assignment by this ump in the slot
  const { data: approved, error } = await sb
    .from("assignments")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: uic.id,
    })
    .eq("umpire_id", orig.umpire_id)
    .eq("status", "requested")
    .in("game_id", slotIds)
    .select("id, game_id");
  if (error) throw error;

  for (const a of approved ?? []) await refreshGameStatus(a.game_id);

  if (orig.umpire_id) {
    await sendPushToUser(orig.umpire_id, {
      title:
        slot.length > 1
          ? `Approved ✅ ${slot.length} games`
          : "Game approved ✅",
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `approved-${g.id}`,
    });
    // One audit entry per bundle, not per assignment
    await logAudit({
      action: "approve",
      actorId: uic.id,
      subjectId: orig.umpire_id,
      gameId: g.id,
      assignmentId,
      details: slot.length > 1 ? { bundle_size: slot.length } : undefined,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/games");
  revalidatePath("/dashboard");
}

export async function declineRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const uic = await requireUic();

  const sb = supabaseServer();

  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, umpire_id, game_id, game:games(id, starts_at, ends_at, division_code, team_home, team_away, field)"
    )
    .eq("id", assignmentId)
    .eq("status", "requested")
    .maybeSingle();
  if (!orig?.game) return;

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
    .update({ status: "declined" })
    .eq("umpire_id", orig.umpire_id)
    .eq("status", "requested")
    .in("game_id", slotIds)
    .select("id, game_id");
  if (error) throw error;

  for (const a of declined ?? []) await refreshGameStatus(a.game_id);

  if (orig.umpire_id) {
    await sendPushToUser(orig.umpire_id, {
      title: "Request declined",
      body: formatGameSummary(g),
      url: "/games",
      tag: `declined-${g.id}`,
    });
    await logAudit({
      action: "decline",
      actorId: uic.id,
      subjectId: orig.umpire_id,
      gameId: g.id,
      assignmentId,
      details: slot.length > 1 ? { bundle_size: slot.length } : undefined,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/games");
}

export async function markPaid(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");

  const board = await requireBoard();
  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_amount: amount,
      paid_by: board.id,
    })
    .eq("id", assignmentId)
    .in("status", ["approved", "confirmed", "completed"])
    .select(
      "umpire_id, game_id, game:games(division_code, team_home, team_away, field, starts_at)"
    )
    .maybeSingle();
  if (error) throw error;

  if (a?.umpire_id && a.game) {
    const g = a.game as unknown as {
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
    };
    await sendPushToUser(a.umpire_id, {
      title: `Paid $${amount} 💵`,
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `paid-${a.game_id}`,
    });
    await logAudit({
      action: "pay",
      actorId: board.id,
      subjectId: a.umpire_id,
      gameId: a.game_id,
      assignmentId,
      details: { amount },
    });
  }

  revalidatePath("/uic");
  revalidatePath("/uic/payouts");
  revalidatePath("/dashboard");
}

export async function undoPaid(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const board = await requireBoard();

  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({
      status: "approved",
      paid_at: null,
      paid_amount: null,
      paid_by: null,
    })
    .eq("id", assignmentId)
    .eq("status", "paid")
    .select("game_id, umpire_id")
    .maybeSingle();
  if (error) throw error;

  if (a) {
    await logAudit({
      action: "unpay",
      actorId: board.id,
      subjectId: a.umpire_id,
      gameId: a.game_id,
      assignmentId,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/uic/payouts");
  revalidatePath("/dashboard");
}

export async function transferAssignment(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const newUmpId = String(formData.get("umpireId") ?? "");
  if (!assignmentId || !newUmpId) throw new Error("Pick a target umpire");

  const uic = await requireUic();
  const sb = supabaseServer();

  const { data: orig } = await sb
    .from("assignments")
    .select(
      "id, umpire_id, game_id, status, game:games(id, starts_at, ends_at, division_code, team_home, team_away, field)"
    )
    .eq("id", assignmentId)
    .in("status", ["requested", "assigned", "approved", "confirmed"])
    .maybeSingle();
  if (!orig?.game) throw new Error("Assignment not found");
  if (orig.umpire_id === newUmpId) return;

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

  // Conflict check on the receiving ump
  const { data: theirActive } = await sb
    .from("assignments")
    .select("game:games(starts_at, ends_at)")
    .eq("umpire_id", newUmpId)
    .in("status", ["requested", "assigned", "approved", "confirmed"]);
  type ActiveRow = { game: { starts_at: string; ends_at: string } | null };
  for (const sg of slot) {
    for (const a of (theirActive ?? []) as unknown as ActiveRow[]) {
      if (!a.game) continue;
      if (sg.starts_at < a.game.ends_at && sg.ends_at > a.game.starts_at) {
        throw new Error("Target ump already has a game at that time");
      }
    }
  }

  const oldUmpId = orig.umpire_id;
  const { error } = await sb
    .from("assignments")
    .update({ umpire_id: newUmpId })
    .eq("umpire_id", oldUmpId)
    .in("status", ["requested", "assigned", "approved", "confirmed"])
    .in("game_id", slotIds);
  if (error) throw error;

  await sendPushToUser(newUmpId, {
    title: `Game transferred to you`,
    body: formatGameSummary(g),
    url: "/dashboard",
    tag: `transfer-${g.id}`,
  });
  await sendPushToUser(oldUmpId, {
    title: `Game moved to another ump`,
    body: formatGameSummary(g),
    url: "/dashboard",
    tag: `transfer-${g.id}`,
  });

  await logAudit({
    action: "swap_execute",
    actorId: uic.id,
    subjectId: newUmpId,
    gameId: g.id,
    assignmentId,
    details: {
      transfer: true,
      from_ump: oldUmpId,
      to_ump: newUmpId,
      bundle_size: slot.length,
    },
  });

  revalidatePath("/uic");
  revalidatePath("/uic/games");
  revalidatePath("/dashboard");
  revalidatePath("/games");
}

export async function toggleTournament(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) throw new Error("Missing gameId");
  const uic = await requireUic();

  const sb = supabaseServer();
  const [{ data: g }, { data: divs }] = await Promise.all([
    sb
      .from("games")
      .select("id, division_code, is_tournament, ump_slots, pay_per_slot")
      .eq("id", gameId)
      .single(),
    sb.from("divisions").select("*"),
  ]);
  if (!g || !divs) throw new Error("Game or divisions not found");
  const div = divs.find((d) => d.code === g.division_code);
  if (!div) throw new Error("Division not found for game");

  const flipping = !g.is_tournament;
  const updates = flipping
    ? {
        is_tournament: true,
        ump_slots: div.tournament_ump_slots,
        pay_per_slot: div.tournament_pay_per_slot,
      }
    : {
        is_tournament: false,
        ump_slots: div.default_ump_slots,
        pay_per_slot: div.default_pay_per_slot,
      };

  const { error } = await sb.from("games").update(updates).eq("id", gameId);
  if (error) throw error;

  revalidatePath("/games");
  revalidatePath("/uic");
  revalidatePath("/dashboard");
}
