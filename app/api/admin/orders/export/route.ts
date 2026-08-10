import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { listOrders } from "@/lib/db";
import { buildOrdersWorkbook } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!await requireAdminApi()) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const workbook = buildOrdersWorkbook(listOrders());
  return new NextResponse(Buffer.from(workbook), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="commandes-lovelystep-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    "cache-control": "no-store",
  } });
}
