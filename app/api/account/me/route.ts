import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ customer: await getCustomerSession() });
}
