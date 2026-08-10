import { redirect } from "next/navigation";
import { getAdminSession, hasAdmin } from "@/lib/auth";
import AdminAuthForm from "../auth-form";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (!hasAdmin()) redirect("/admin/setup");
  if (await getAdminSession()) redirect("/admin");
  return <AdminAuthForm mode="login" />;
}
