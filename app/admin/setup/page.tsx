import { redirect } from "next/navigation";
import { hasAdmin } from "@/lib/auth";
import AdminAuthForm from "../auth-form";

export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (await hasAdmin()) redirect("/admin/login");
  return <AdminAuthForm mode="setup" />;
}
