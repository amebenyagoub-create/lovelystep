import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sheetOutboxDepth } from "@/lib/db-postgres";
import { drainOrderSheetOutbox, syncOrderStatesFromGoogleSheet } from "@/lib/google-sheets";
import { log, errorMessage } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Constant-time comparison so the secret cannot be recovered by timing the response. */
function authorized(request: Request): boolean {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  // No secret configured means the endpoint stays closed rather than open.
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Scheduled Google Sheet reconciliation, both directions.
 *
 * Push: any order whose row never reached the Sheet. Until it does, the external
 * confirmation agent does not know the order exists — no WhatsApp message, no
 * parcel, and the customer hears nothing.
 *
 * Pull: order states written back by the agent. This used to happen only when an
 * admin opened the dashboard, so the database could sit days behind reality.
 *
 * Both halves run even if the other fails.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const outcome: Record<string, unknown> = {};
  let ok = true;

  try {
    outcome.outbox = await drainOrderSheetOutbox(100);
  } catch (error) {
    ok = false;
    outcome.outboxError = errorMessage(error, "Échec de l'export");
    log.actionRequired("sheet_outbox_drain_failed", { message: outcome.outboxError });
  }

  try {
    const pulled = await syncOrderStatesFromGoogleSheet();
    outcome.states = { updated: pulled.updated, unknownStates: pulled.unknownStates };
    // An unrecognised state means the agent knows something the store cannot read.
    if (pulled.unknownStates.length) log.actionRequired("sheet_states_unknown", { states: pulled.unknownStates });
  } catch (error) {
    ok = false;
    outcome.statesError = errorMessage(error, "Échec de la lecture des états");
    log.actionRequired("sheet_state_pull_failed", { message: outcome.statesError });
  }

  try {
    outcome.depth = await sheetOutboxDepth();
  } catch {
    // Depth is diagnostic only; never fail the run over it.
  }

  return NextResponse.json({ ok, ...outcome }, { status: ok ? 200 : 500 });
}
