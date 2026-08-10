import { redirect } from "next/navigation";
import { hasAdmin } from "@/lib/auth";
import AdminAuthForm from "../auth-form";

export const dynamic = "force-dynamic";
export default function SetupPage() {
  if (hasAdmin()) redirect("/admin/login");
  return <AdminAuthForm mode="setup" />;
}
