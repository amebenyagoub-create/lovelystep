import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, createExpense, deleteExpense, updateExpense } from "@/lib/db-postgres";
import type { Expense, ExpenseAllocationMethod, ExpenseCostType, ExpenseRecurrence } from "@/lib/types";

const recurrences: ExpenseRecurrence[] = ["one_time", "recurring"];
const costTypes: ExpenseCostType[] = ["fixed", "variable"];
const allocationMethods: ExpenseAllocationMethod[] = ["revenue_weighted", "even_split"];

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Partial<Expense> & { id?: number };
  const id = body.id == null ? undefined : Number(body.id);
  const category = String(body.category ?? "").trim().slice(0, 80);
  const amountCents = Number(body.amountCents);
  const effectiveFrom = String(body.effectiveFrom ?? "").trim();
  const recurrence = recurrences.includes(body.recurrence as ExpenseRecurrence) ? body.recurrence as ExpenseRecurrence : null;
  const costType = costTypes.includes(body.costType as ExpenseCostType) ? body.costType as ExpenseCostType : null;
  const allocationMethod = allocationMethods.includes(body.allocationMethod as ExpenseAllocationMethod) ? body.allocationMethod as ExpenseAllocationMethod : null;
  if ((id !== undefined && (!Number.isInteger(id) || id < 1)) || category.length < 2 || !Number.isInteger(amountCents) || amountCents < 0 || amountCents > 1_000_000_000
    || Number.isNaN(Date.parse(effectiveFrom)) || !recurrence || !costType || !allocationMethod) {
    return NextResponse.json({ error: "Dépense invalide." }, { status: 400 });
  }
  const effectiveTo = body.effectiveTo ? String(body.effectiveTo).trim() : null;
  if (effectiveTo && Number.isNaN(Date.parse(effectiveTo))) return NextResponse.json({ error: "Date de fin invalide." }, { status: 400 });
  const input = { category, amountCents, currency: "DZD", recurrence, costType, effectiveFrom, effectiveTo, allocationMethod, notes: String(body.notes ?? "").trim().slice(0, 500), source: String(body.source ?? "manual").trim().slice(0, 80) };
  const expense = id ? await updateExpense(id, input) : await createExpense(input);
  if (!expense) return NextResponse.json({ error: "Dépense introuvable." }, { status: 404 });
  await audit(session.adminId, id ? "expense.update" : "expense.create", "expense", String(expense.id), { category: expense.category, amountCents: expense.amountCents });
  return NextResponse.json({ expense });
}

export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Dépense invalide." }, { status: 400 });
  const deleted = await deleteExpense(id);
  if (!deleted) return NextResponse.json({ error: "Dépense introuvable." }, { status: 404 });
  await audit(session.adminId, "expense.delete", "expense", String(id));
  return NextResponse.json({ ok: true });
}
