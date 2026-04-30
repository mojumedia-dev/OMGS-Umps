import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OMGS Umpire Scheduling",
  description: "Game requests, assignments, and pay tracking for OMGS umpires.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
          <header className="border-b border-zinc-200 bg-white">
            <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm font-semibold tracking-tight"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-900 text-[10px] font-bold text-white">
                  OMGS
                </span>
                Umps
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link
                  href="/games"
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  Schedule
                </Link>
                <Show when="signed-in">
                  <Link
                    href="/dashboard"
                    className="text-zinc-600 hover:text-zinc-900"
                  >
                    My games
                  </Link>
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <Link
                    href="/sign-in"
                    className="inline-flex h-8 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800"
                  >
                    Sign in
                  </Link>
                </Show>
              </nav>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
