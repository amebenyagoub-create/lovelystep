"use client";

import { useEffect, useState } from "react";

export type StoreLocale = "fr" | "en" | "ar";

const dictionary = {
  fr: {
    new: "Nouveautés", promise: "Notre promesse", cart: "Panier", account: "Mon compte", collection: "La collection Lovely Step",
    favorites: "Nos favoris du moment", collectionText: "Des pièces faciles à assortir, sélectionnées pour accompagner le quotidien des petits.",
    viewProduct: "Voir le produit", cod: "Payez à la livraison", codText: "Aucune carte bancaire nécessaire", tracked: "Livraison suivie", trackedText: "Confirmation avant chaque envoi",
    children: "Pensé pour les enfants", childrenText: "Confort, douceur et liberté", exchange: "Échange facile", exchangeText: "Une taille à corriger ? On vous aide",
    noOnline: "Sans paiement en ligne", phoneConfirm: "Confirmation par téléphone", findOutfit: "Trouver leur prochaine tenue", rights: "Tous droits réservés.",
    yourCart: "Votre panier", item: "article", items: "articles", emptyCart: "Votre panier est vide", emptyCartText: "Il ne manque qu’un joli coup de cœur.",
    seeCollection: "Voir la collection", size: "Taille", color: "Couleur", subtotal: "Sous-total", delivery: "Livraison", checkout: "Commander", cash: "Vous paierez en espèces à la livraison.",
    finish: "Finaliser ma commande", fullName: "Nom et prénom", firstName: "Prénom", lastName: "Nom", phone: "Téléphone", wilaya: "Wilaya", commune: "Commune", choose: "Choisir…",
    deliveryMode: "Mode de livraison", home: "À domicile", office: "Au bureau du transporteur", address: "Adresse complète", optionalAddress: "Adresse (facultatif)", note: "Note pour la livraison (facultatif)",
    shippingPrice: "Frais de livraison", total: "Total à payer à la livraison", confirm: "Confirmer ma commande", sending: "Envoi…", finishButton: "Terminer",
    orderHelp: "Notre équipe vous appellera pour confirmer les articles et la livraison.", login: "Connexion", register: "Créer un compte", password: "Mot de passe", passwordHelp: "8 caractères minimum",
    welcome: "Bienvenue", savedAddress: "Votre adresse est enregistrée et préremplie à la commande.", logout: "Se déconnecter", accountTitle: "Espace client", accountError: "Action impossible.",
  },
  en: {
    new: "New arrivals", promise: "Our promise", cart: "Cart", account: "My account", collection: "The Lovely Step collection",
    favorites: "Our current favourites", collectionText: "Easy-to-match pieces selected for little ones’ everyday adventures.",
    viewProduct: "View product", cod: "Cash on delivery", codText: "No bank card required", tracked: "Tracked delivery", trackedText: "Confirmation before every shipment",
    children: "Made for children", childrenText: "Comfort, softness and freedom", exchange: "Easy exchange", exchangeText: "Wrong size? We will help",
    noOnline: "No online payment", phoneConfirm: "Confirmation by phone", findOutfit: "Find their next outfit", rights: "All rights reserved.",
    yourCart: "Your cart", item: "item", items: "items", emptyCart: "Your cart is empty", emptyCartText: "Your next favourite is waiting.",
    seeCollection: "Shop the collection", size: "Size", color: "Colour", subtotal: "Subtotal", delivery: "Delivery", checkout: "Order", cash: "You will pay cash on delivery.",
    finish: "Complete my order", fullName: "Full name", firstName: "First name", lastName: "Last name", phone: "Phone", wilaya: "Wilaya", commune: "Commune", choose: "Choose…",
    deliveryMode: "Delivery method", home: "Home delivery", office: "Carrier office", address: "Full address", optionalAddress: "Address (optional)", note: "Delivery note (optional)",
    shippingPrice: "Delivery fee", total: "Total due on delivery", confirm: "Confirm my order", sending: "Sending…", finishButton: "Done",
    orderHelp: "Our team will call to confirm the items and delivery.", login: "Sign in", register: "Create account", password: "Password", passwordHelp: "At least 8 characters",
    welcome: "Welcome", savedAddress: "Your saved address will be prefilled at checkout.", logout: "Sign out", accountTitle: "Customer account", accountError: "Action failed.",
  },
  ar: {
    new: "الجديد", promise: "وعدنا", cart: "السلة", account: "حسابي", collection: "تشكيلة Lovely Step",
    favorites: "اختياراتنا المفضلة", collectionText: "قطع سهلة التنسيق مختارة لترافق يوميات أطفالكم.",
    viewProduct: "عرض المنتج", cod: "الدفع عند الاستلام", codText: "لا حاجة لبطاقة بنكية", tracked: "توصيل متابع", trackedText: "تأكيد قبل كل شحنة",
    children: "مصمم للأطفال", childrenText: "راحة ونعومة وحرية", exchange: "استبدال سهل", exchangeText: "المقاس غير مناسب؟ نحن نساعدكم",
    noOnline: "دون دفع إلكتروني", phoneConfirm: "تأكيد عبر الهاتف", findOutfit: "اختاروا إطلالتهم القادمة", rights: "جميع الحقوق محفوظة.",
    yourCart: "سلة التسوق", item: "منتج", items: "منتجات", emptyCart: "السلة فارغة", emptyCartText: "اختيار جميل بانتظاركم.",
    seeCollection: "عرض التشكيلة", size: "المقاس", color: "اللون", subtotal: "المجموع الفرعي", delivery: "التوصيل", checkout: "اطلب الآن", cash: "الدفع نقداً عند الاستلام.",
    finish: "إتمام الطلب", fullName: "الاسم واللقب", firstName: "الاسم", lastName: "اللقب", phone: "الهاتف", wilaya: "الولاية", commune: "البلدية", choose: "اختاروا…",
    deliveryMode: "طريقة التوصيل", home: "إلى المنزل", office: "إلى مكتب شركة التوصيل", address: "العنوان الكامل", optionalAddress: "العنوان (اختياري)", note: "ملاحظة للتوصيل (اختياري)",
    shippingPrice: "سعر التوصيل", total: "المبلغ عند الاستلام", confirm: "تأكيد الطلب", sending: "جارٍ الإرسال…", finishButton: "إنهاء",
    orderHelp: "سيتصل فريقنا لتأكيد المنتجات والتوصيل.", login: "تسجيل الدخول", register: "إنشاء حساب", password: "كلمة المرور", passwordHelp: "8 أحرف على الأقل",
    welcome: "مرحباً", savedAddress: "سيتم ملء عنوانكم المحفوظ تلقائياً عند الطلب.", logout: "تسجيل الخروج", accountTitle: "فضاء الزبون", accountError: "تعذر تنفيذ العملية.",
  },
} as const;

export type TranslationKey = keyof typeof dictionary.fr;

export function useLocale() {
  const [locale, setLocaleState] = useState<StoreLocale>("fr");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem("lovelystep_locale");
      if (saved === "fr" || saved === "en" || saved === "ar") setLocaleState(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    localStorage.setItem("lovelystep_locale", locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  const setLocale = (value: StoreLocale) => setLocaleState(value);
  const t = (key: TranslationKey) => dictionary[locale][key];
  return { locale, setLocale, t, dir: locale === "ar" ? "rtl" as const : "ltr" as const };
}
