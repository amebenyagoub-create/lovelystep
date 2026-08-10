import { requireAdminPage } from "@/lib/auth";
import AdminDashboard from "./admin-dashboard";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  await requireAdminPage();
  return <AdminDashboard />;
}
