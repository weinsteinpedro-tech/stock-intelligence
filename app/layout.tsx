import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stock Intelligence",
  description: "Search stocks, track your watchlist, and analyze market factors with AI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Stock Intelligence
            </Link>
            <nav className="flex gap-1 text-sm font-medium">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Dashboard
              </Link>
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Watchlist
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
