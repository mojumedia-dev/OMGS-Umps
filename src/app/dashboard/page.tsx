import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await currentUser();

  return (
    <main className="flex flex-1 flex-col px-6 py-10 sm:px-10">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {user?.firstName ?? "umpire"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Wk1 stub — game list, request, and pay views land here.
        </p>
      </div>
    </main>
  );
}
