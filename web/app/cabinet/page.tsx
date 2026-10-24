import type { Metadata } from "next";
import Cabinet from "./cabinet";
import "./cabinet.css";

export const metadata: Metadata = { title: "ThuocTracker · Cabinet" };

// Runs full-screen in Chromium kiosk mode on the Pi touchscreen. ?patient=<id> (default 1).
export default function CabinetPage() {
  return <Cabinet />;
}
