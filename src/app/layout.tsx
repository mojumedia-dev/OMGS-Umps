import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import HeaderNav from "@/components/HeaderNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OMGS Umpire Scheduling",
  description: "Game requests, assignments, and pay tracking for OMGS umpires.",
  manifest: "/manifest.json",
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
          <header className="bg-brand-700 text-white shadow-sm">
            <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm font-bold tracking-tight"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-lime-400 text-[10px] font-extrabold text-brand-900">
                  OMGS
                </span>
                <span className="text-white">Umps</span>
              </Link>
              <nav className="flex items-center gap-3 text-sm sm:gap-4">
                <Link
                  href="/games"
                  className="font-medium text-white/85 hover:text-white"
                >
                  Schedule
                </Link>
                <HeaderNav />
              </nav>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
