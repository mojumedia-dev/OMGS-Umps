import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await currentUser();

  const sb = supabaseServer();
  const { count: gamesCount } = await sb
    .from("games")
    .select("*", { count: "exact", head: true });
  const { count: openCount } = await sb
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome, {user?.firstName ?? "umpire"}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {gamesCount ?? 0} games loaded · {openCount ?? 0} open
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/games"
            className="block rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            <h2 className="text-base font-semibold">Schedule</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Browse all games for the season.
            </p>
          </Link>
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-700">
              My assignments
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Coming in Wk2 — you&apos;ll request games here.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
