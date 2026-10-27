import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { Analytics } from "@/components/analytics/analytics";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PickMyHire.ai", template: "%s · PickMyHire.ai" },
  description: "Structured, evidence-based AI video interviews for recruiting teams.",
  // Set here (not as app/icon.png) so candidate pages can replace it with the company's logo.
  icons: { icon: "/brand/icon.png", apple: "/brand/apple-icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="bottom-right" richColors closeButton />
        <Analytics />
      </body>
    </html>
  );
}
