import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HeaderNav() {
  const { userId } = await auth();

  let role: string | null = null;
  if (userId) {
    const sb = supabaseServer();
    const { data } = await sb
      .from("users")
      .select("role")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    role = (data?.role as string) ?? null;
  }

  const showApprovals = role === "uic" || role === "admin";
  const showPayouts = role === "board" || role === "admin";

  if (!userId) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex h-8 items-center justify-center rounded-md bg-lime-400 px-3 text-xs font-bold text-brand-900 hover:bg-lime-500"
      >
        Sign in
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/dashboard"
        className="font-medium text-white/85 hover:text-white"
      >
        My games
      </Link>
      {showApprovals && (
        <Link
          href="/uic"
          className="font-medium text-white/85 hover:text-white"
        >
          Approvals
        </Link>
      )}
      {showPayouts && (
        <Link
          href="/uic/payouts"
          className="font-medium text-white/85 hover:text-white"
        >
          Payouts
        </Link>
      )}
      <Link
        href="/profile"
        className="font-medium text-white/85 hover:text-white"
      >
        Profile
      </Link>
      <span className="text-[10px] text-white/40 hidden sm:inline">
        role: {role ?? "—"}
      </span>
      <UserButton />
    </>
  );
}
