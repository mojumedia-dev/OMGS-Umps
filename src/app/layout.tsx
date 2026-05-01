import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase/server";
import HeaderMenu from "@/components/HeaderMenu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OMGS Umpire Scheduling",
  description: "Game requests, assignments, and pay tracking for OMGS umpires.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "OMGS Umps",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#4a1d6e",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
  const signedIn = !!userId;
  const showApprovals = role === "uic" || role === "admin";
  const showAssign = role === "board" || role === "admin";
  const showPayouts = role === "board" || role === "admin";
  const showAudit =
    role === "uic" || role === "admin" || role === "board";

  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col overflow-x-hidden bg-zinc-50 text-zinc-900">
          <header className="relative bg-brand-700 text-white shadow-sm">
            <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm font-bold tracking-tight"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="OMGS"
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-md bg-white object-contain p-0.5"
                />
                <span className="text-white">Umps</span>
              </Link>
              <HeaderMenu
                signedIn={signedIn}
                showApprovals={showApprovals}
                showAssign={showAssign}
                showRoster={showApprovals}
                showPayouts={showPayouts}
                showAudit={showAudit}
                userButton={<UserButton />}
              />
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
