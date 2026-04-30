import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export type AuditAction =
  | "request"
  | "cancel"
  | "approve"
  | "decline"
  | "pay"
  | "unpay"
  | "tournament_toggle"
  | "swap_propose"
  | "swap_accept"
  | "swap_decline"
  | "swap_cancel"
  | "swap_execute";

export interface AuditEvent {
  action: AuditAction;
  actorId: string | null;
  subjectId?: string | null;
  gameId?: string | null;
  assignmentId?: string | null;
  swapRequestId?: string | null;
  details?: Record<string, unknown>;
}

export async function logAudit(e: AuditEvent): Promise<void> {
  try {
    const sb = supabaseServer();
    await sb.from("audit_log").insert({
      action: e.action,
      actor_id: e.actorId,
      subject_id: e.subjectId ?? null,
      game_id: e.gameId ?? null,
      assignment_id: e.assignmentId ?? null,
      swap_request_id: e.swapRequestId ?? null,
      details: e.details ?? null,
    });
  } catch (err) {
    // Audit failures must never break the primary flow
    console.error("audit log failed", { action: e.action, err });
  }
}
