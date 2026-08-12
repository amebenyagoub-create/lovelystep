import "server-only";

import {
  markWhatsAppEventSent,
  processWhatsAppOrderAction,
  releaseWhatsAppEventDelivery,
  type WhatsAppOrderActionResult,
} from "@/lib/db-postgres";
import { siteUrl } from "@/lib/site-url";
import type { Order } from "@/lib/types";
import { sendWhatsAppButtons, sendWhatsAppList, sendWhatsAppText } from "./client";
import { detectWhatsAppLanguage, parseWhatsAppOrderAction, type WhatsAppLanguage } from "./intent";

export type IncomingWhatsAppMessage = {
  from?: string;
  id?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

function incomingText(message: IncomingWhatsAppMessage): string {
  return [
    message.text?.body,
    message.button?.payload,
    message.button?.text,
    message.interactive?.button_reply?.id,
    message.interactive?.button_reply?.title,
    message.interactive?.list_reply?.id,
    message.interactive?.list_reply?.title,
  ].filter(Boolean).join(" ").trim();
}

function money(cents: number, language: WhatsAppLanguage): string {
  return new Intl.NumberFormat(language === "ar" ? "ar-DZ" : language === "en" ? "en-DZ" : "fr-DZ", {
    style: "currency", currency: "DZD", maximumFractionDigits: 0,
  }).format(cents / 100);
}

function publicImageUrl(order: Order): string | null {
  const image = order.items[0]?.image?.trim();
  if (!image) return null;
  try {
    const url = new URL(image, siteUrl());
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:") ? url.toString() : null;
  } catch { return null; }
}

function orderSummary(order: Order, language: WhatsAppLanguage): string {
  const item = order.items[0];
  const itemText = item ? `${item.name}\n${language === "ar" ? "المقاس" : language === "en" ? "Size" : "Taille"} : ${item.size}${item.color ? ` · ${item.color}` : ""}\n${language === "ar" ? "الكمية" : language === "en" ? "Quantity" : "Quantité"} : ${item.quantity}` : order.orderNumber;
  if (language === "ar") return `مرحباً ${order.firstName || order.customerName} 👋\n\nاستلمنا طلبك.\n\n🛍 ${itemText}\n\n📍 ${order.commune}، ${order.wilayaName}\n💰 المبلغ: ${money(order.totalCents, language)}\n\nهل تريد تأكيد الطلب؟`;
  if (language === "en") return `Hello ${order.firstName || order.customerName} 👋\n\nWe received your order.\n\n🛍 ${itemText}\n\n📍 ${order.commune}, ${order.wilayaName}\n💰 Total: ${money(order.totalCents, language)}\n\nWould you like to confirm it?`;
  return `Bonjour ${order.firstName || order.customerName} 👋\n\nNous avons bien reçu votre commande.\n\n🛍 ${itemText}\n\n📍 ${order.commune}, ${order.wilayaName}\n💰 Total : ${money(order.totalCents, language)}\n\nSouhaitez-vous la confirmer ?`;
}

async function sendResult(result: Exclude<WhatsAppOrderActionResult, { status: "duplicate" | "retry_later" }>, to: string, inboundMessageId: string, language: WhatsAppLanguage): Promise<string> {
  if (result.status === "order_not_found" || result.status === "phone_mismatch" || result.status === "ambiguous_order") {
    const body = language === "ar"
      ? "لم أتمكن من مطابقة رقم هاتفك مع الطلب. أرسل رقم الطلب كاملاً مثل LS-260811-XXXXXXXX."
      : language === "en"
        ? "I could not match your phone number to the order. Send the full order number, for example LS-260811-XXXXXXXX."
        : "Je n’ai pas pu associer votre numéro au bon de commande. Envoyez le numéro complet, par exemple LS-260811-XXXXXXXX.";
    return sendWhatsAppText(to, body, inboundMessageId);
  }

  if (!("order" in result)) throw new Error("WHATSAPP_ORDER_RESULT_INVALID");
  const { order } = result;
  if (result.status === "present_confirmation") {
    return sendWhatsAppButtons({
      to,
      body: orderSummary(order, language),
      imageUrl: publicImageUrl(order),
      footer: "Lovely Step · Paiement à la livraison",
      replyToMessageId: inboundMessageId,
      buttons: [
        { id: `confirm_order:${order.orderNumber}`, title: language === "ar" ? "✅ تأكيد" : language === "en" ? "✅ Confirm" : "✅ Confirmer" },
        { id: `reject_order:${order.orderNumber}`, title: language === "ar" ? "❌ عدم التأكيد" : language === "en" ? "❌ Do not confirm" : "❌ Ne pas confirmer" },
      ],
    });
  }
  if (result.status === "present_reasons") {
    const prefix = order.orderNumber;
    return sendWhatsAppList({
      to,
      body: language === "ar" ? "لا بأس 😊 ما هو السبب؟ سنقترح حلاً واحداً فقط." : language === "en" ? "No problem 😊 What is the reason? We will suggest at most one solution." : "Pas de souci 😊 Quelle est la raison ? Nous proposerons au maximum une solution.",
      buttonLabel: language === "ar" ? "اختر السبب" : language === "en" ? "Choose a reason" : "Choisir le motif",
      footer: "Lovely Step",
      replyToMessageId: inboundMessageId,
      rows: [
        { id: `reason_price:${prefix}`, title: "💰 Le prix" },
        { id: `reason_size:${prefix}`, title: "📏 La taille" },
        { id: `reason_color:${prefix}`, title: "🎨 La couleur" },
        { id: `reason_delivery:${prefix}`, title: "📍 La livraison" },
        { id: `reason_later:${prefix}`, title: "⏰ Pas maintenant" },
        { id: `reason_duplicate:${prefix}`, title: "🔁 Commande en double" },
        { id: `reason_changed_mind:${prefix}`, title: "❌ Je n’en veux plus" },
      ],
    });
  }
  if (result.status === "price_solution") {
    return sendWhatsAppButtons({
      to,
      body: language === "ar" ? `أتفهم 👍 المبلغ الإجمالي هو ${money(order.totalCents, language)}، شامل التوصيل. هل تريد الاحتفاظ بالطلب؟` : language === "en" ? `I understand 👍 The total is ${money(order.totalCents, language)}, including delivery. Would you still like to keep it?` : `Je comprends 👍 Le total est de ${money(order.totalCents, language)}, livraison comprise. Souhaitez-vous tout de même la garder ?`,
      replyToMessageId: inboundMessageId,
      buttons: [
        { id: `confirm_order:${order.orderNumber}`, title: language === "ar" ? "✅ نعم، تأكيد" : language === "en" ? "✅ Yes, confirm" : "✅ Oui, confirmer" },
        { id: `cancel_order:${order.orderNumber}`, title: language === "ar" ? "❌ إلغاء" : language === "en" ? "❌ Cancel" : "❌ Non, annuler" },
      ],
    });
  }
  if (result.status === "needs_human") {
    const reason = result.action === "reason_size" ? "la taille" : result.action === "reason_color" ? "la couleur" : result.action === "reason_delivery" ? "la livraison" : "la commande en double";
    return sendWhatsAppText(to, language === "ar" ? `سيتواصل معك فريق Lovely Step لتعديل الطلب ${order.orderNumber}. لن نرسل رسائل تذكير مدفوعة.` : language === "en" ? `The Lovely Step team will contact you to update order ${order.orderNumber}. We will not send paid reminders.` : `L’équipe Lovely Step traitera ${reason} pour la commande ${order.orderNumber}. Aucun rappel payant ne sera envoyé.`, inboundMessageId);
  }
  if (result.status === "deferred") {
    return sendWhatsAppText(to, language === "ar" ? `لا بأس 👍 سيبقى الطلب ${order.orderNumber} في انتظار قرارك. عد إلى رابط التأكيد عندما تكون جاهزاً.` : language === "en" ? `No problem 👍 Order ${order.orderNumber} will wait for your decision. Use the confirmation link again when you are ready.` : `Pas de problème 👍 La commande ${order.orderNumber} reste en attente. Revenez par le lien de confirmation lorsque vous serez prêt.`, inboundMessageId);
  }
  if (result.status === "confirmed") {
    return sendWhatsAppText(to, language === "ar" ? `تم تأكيد طلبك ${order.orderNumber} ✅\nالمبلغ عند الاستلام: ${money(order.totalCents, language)}\nالتوصيل: ${order.commune}، ${order.wilayaName}.` : language === "en" ? `Your order ${order.orderNumber} is confirmed ✅\nCash on delivery: ${money(order.totalCents, language)}\nDelivery: ${order.commune}, ${order.wilayaName}.` : `Votre commande ${order.orderNumber} est confirmée ✅\nÀ payer à la livraison : ${money(order.totalCents, language)}\nLivraison : ${order.commune}, ${order.wilayaName}.`, inboundMessageId);
  }
  if (result.status === "cancelled") {
    return sendWhatsAppText(to, language === "ar" ? `تم إلغاء الطلب ${order.orderNumber}. شكراً لإبلاغنا.` : language === "en" ? `Order ${order.orderNumber} has been cancelled. Thank you for letting us know.` : `La commande ${order.orderNumber} est annulée. Merci de nous avoir prévenus.`, inboundMessageId);
  }
  if (result.status === "already_confirmed") {
    return sendWhatsAppText(to, language === "ar" ? `الطلب ${order.orderNumber} مؤكد بالفعل ✅` : language === "en" ? `Order ${order.orderNumber} is already confirmed ✅` : `La commande ${order.orderNumber} est déjà confirmée ✅`, inboundMessageId);
  }
  if (result.status === "already_cancelled") {
    return sendWhatsAppText(to, language === "ar" ? `الطلب ${order.orderNumber} ملغى بالفعل.` : language === "en" ? `Order ${order.orderNumber} is already cancelled.` : `La commande ${order.orderNumber} est déjà annulée.`, inboundMessageId);
  }
  return sendWhatsAppText(to, language === "ar" ? `الطلب ${order.orderNumber} قيد التحضير أو الشحن. سيتواصل معك فريق Lovely Step لأي تعديل.` : language === "en" ? `Order ${order.orderNumber} is being prepared or shipped. The Lovely Step team must handle any change.` : `La commande ${order.orderNumber} est déjà en préparation ou en livraison. L’équipe Lovely Step doit traiter toute modification.`, inboundMessageId);
}

export async function handleIncomingWhatsAppMessage(message: IncomingWhatsAppMessage): Promise<void> {
  const from = String(message.from ?? "");
  const messageId = String(message.id ?? "");
  if (!from || !messageId) return;

  const text = incomingText(message);
  const language = detectWhatsAppLanguage(text);
  const parsed = parseWhatsAppOrderAction(text);
  const result = await processWhatsAppOrderAction({ ...parsed, messageId, senderPhone: from });
  if (result.status === "duplicate") return;
  if (result.status === "retry_later") throw new Error("WHATSAPP_EVENT_RETRY_LATER");
  try {
    const providerMessageId = await sendResult(result, from, messageId, language);
    await markWhatsAppEventSent(messageId, providerMessageId);
  } catch (error) {
    await releaseWhatsAppEventDelivery(messageId).catch(() => undefined);
    throw error;
  }
}
