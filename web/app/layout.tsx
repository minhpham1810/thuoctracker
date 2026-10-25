import type { Metadata } from "next";
import { Be_Vietnam_Pro, Figtree, Noto_Sans } from "next/font/google";
import "./globals.css";

const heading = Figtree({ variable: "--font-heading", subsets: ["latin"], weight: ["500", "600", "700"] });
const body = Noto_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
// Dashboard face: drawn for Vietnamese diacritics (patients' names, "thuốc")
const ui = Be_Vietnam_Pro({ variable: "--font-ui", subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "ThuocTracker",
  description: "Smart medicine cabinet connected to the doctor.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
