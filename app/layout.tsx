// app/layout.tsx

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import { PatientProvider } from "./context/PatientContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "状況記録表兼報告書",
  description: "Patient daily status recording and monthly report app.",
  manifest: "/manifest.json",
  icons: [
    { rel: "icon", url: "/favicon.ico" },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "状況記録表",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AuthProvider>
          <PatientProvider>{children}</PatientProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
