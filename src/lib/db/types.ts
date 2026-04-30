export type UserRole = "umpire" | "uic" | "board" | "admin";

export type DivisionCode = "8U" | "10U" | "12U" | "14U" | "16U" | "18U";

export type GameStatus =
  | "open"
  | "partial"
  | "filled"
  | "cancelled"
  | "completed";

export type AssignmentStatus =
  | "requested"
  | "approved"
  | "declined"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "paid";

export type SwapStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "approved"
  | "cancelled";

export interface Division {
  code: DivisionCode;
  display_name: string;
  default_ump_slots: number;
  default_pay_per_slot: number;
  tournament_pay_per_slot: number;
  tournament_ump_slots: number;
  display_order: number;
}

export interface User {
  id: string;
  clerk_user_id: string;
  role: UserRole;
  full_name: string;
  email: string | null;
  phone: string | null;
  eligible_divisions: DivisionCode[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  division_code: DivisionCode;
  team_home: string;
  team_away: string;
  field: string;
  starts_at: string;
  ends_at: string;
  ump_slots: number;
  pay_per_slot: number;
  is_tournament: boolean;
  status: GameStatus;
  notes: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  game_id: string;
  umpire_id: string;
  status: AssignmentStatus;
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  paid_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
