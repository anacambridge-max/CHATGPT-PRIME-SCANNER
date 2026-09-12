import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PRIME Scanner",
  description: "Read-only Upstox F&O technical scanner",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
