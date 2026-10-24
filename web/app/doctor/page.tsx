import type { Metadata } from "next";
import Dashboard from "./dashboard";
import "./doctor.css";

export const metadata: Metadata = { title: "ThuocTracker · Doctor" };

export default function DoctorPage() {
  return <Dashboard />;
}
