import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          OMGS Umpire Scheduling
        </h1>
        <p className="mt-3 text-base text-zinc-600">
          Request games, see your schedule, get paid.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Sign in
          </Link>
          <Link
            href="/games"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-6 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
          >
            View schedule
          </Link>
        </div>
      </div>
    </main>
  );
}
