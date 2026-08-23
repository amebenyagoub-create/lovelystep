"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";

/**
 * Pages légales de la boutique.
 *
 * Le contenu décrit ce que le code fait réellement — Pixel et Conversions API sous consentement,
 * agent WhatsApp initié par le client, ZR Express pour la livraison, durées de conservation des
 * variables RETENTION_*. Toute évolution du suivi doit être reportée ici : une politique qui
 * décrit autre chose que le code est pire que pas de politique du tout.
 */

export type LegalKind = "privacy" | "deletion";

type Section = { title: string; paragraphs: string[]; bullets?: string[] };
type Content = { title: string; updated: string; intro: string; sections: Section[]; back: string };

const CONTACT = "piece.detaches16@gmail.com";
const UPDATED = "2026-08-12";

const content: Record<"fr" | "en" | "ar", Record<LegalKind, Content>> = {
  fr: {
    privacy: {
      title: "Politique de confidentialité",
      updated: `Dernière mise à jour : ${UPDATED}`,
      back: "Retour à la boutique",
      intro:
        "Lovely Step vend des vêtements pour enfants en Algérie, avec paiement à la livraison. Cette page décrit précisément les données que nous collectons, pourquoi, combien de temps nous les gardons, et comment vous pouvez les faire supprimer.",
      sections: [
        {
          title: "Les données que vous nous donnez",
          paragraphs: ["Pour traiter une commande, nous avons besoin de :"],
          bullets: [
            "votre nom et prénom",
            "votre numéro de téléphone, utilisé pour la confirmation et la livraison",
            "votre wilaya, votre commune et, en livraison à domicile, votre adresse",
            "le détail de votre commande : articles, tailles, couleurs, quantités, montant",
          ],
        },
        {
          title: "Aucun paiement en ligne",
          paragraphs: [
            "Vous payez en espèces à la livraison. Nous ne demandons, ne traitons ni ne conservons aucune donnée bancaire. Aucun numéro de carte ne transite par ce site.",
          ],
        },
        {
          title: "Livraison",
          paragraphs: [
            "Votre nom, votre téléphone et votre adresse sont transmis à ZR Express, notre transporteur, uniquement pour acheminer votre colis. Ils ne lui servent à rien d'autre.",
          ],
        },
        {
          title: "Confirmation par WhatsApp",
          paragraphs: [
            "Après votre commande, notre agent de confirmation peut vous contacter sur WhatsApp au numéro fourni afin de vérifier les informations et votre décision avant l'expédition.",
            "L'échange passe par WhatsApp Cloud API, un service de Meta. Les identifiants techniques, les actions choisies et les messages nécessaires au suivi de la commande peuvent être conservés afin de traiter correctement votre réponse.",
          ],
        },
        {
          title: "Mesure publicitaire, uniquement avec votre accord",
          paragraphs: [
            "Si vous acceptez la bannière de consentement, nous utilisons le Pixel Meta et l'API de conversions afin de comprendre quelles publicités amènent des commandes.",
            "Si vous refusez, rien n'est chargé : aucun script Meta, aucun cookie de mesure, aucune adresse IP transmise. Le refus est le comportement par défaut tant que vous n'avez pas choisi.",
            "Les données transmises à Meta sont hachées avant l'envoi. Nous ne lui transmettons jamais votre nom ni votre numéro en clair.",
          ],
        },
        {
          title: "Combien de temps nous gardons vos données",
          paragraphs: ["Les durées appliquées automatiquement :"],
          bullets: [
            "visites et statistiques d'audience : 180 jours",
            "événements de mesure publicitaire : 180 jours",
            "données d'attribution : 400 jours",
            "commandes et factures : conservées, car la loi comptable l'impose",
          ],
        },
        {
          title: "Où vos données sont hébergées",
          paragraphs: [
            "La base de données et les images sont hébergées chez Supabase, sur des serveurs situés en Europe. Le site est déployé sur Railway. Ces prestataires n'utilisent pas vos données pour leur propre compte.",
          ],
        },
        {
          title: "Vos droits",
          paragraphs: [
            `Vous pouvez demander à consulter, corriger ou supprimer vos données en écrivant à ${CONTACT}. Nous répondons sous 30 jours. La procédure de suppression est détaillée sur la page prévue à cet effet.`,
          ],
        },
      ],
    },
    deletion: {
      title: "Suppression de vos données",
      updated: `Dernière mise à jour : ${UPDATED}`,
      back: "Retour à la boutique",
      intro:
        "Vous pouvez demander la suppression des données personnelles que Lovely Step détient sur vous. Voici comment procéder et ce qui sera effectivement supprimé.",
      sections: [
        {
          title: "Comment demander la suppression",
          paragraphs: [`Envoyez un courriel à ${CONTACT} avec :`],
          bullets: [
            "pour objet : « Suppression de mes données »",
            "le numéro de téléphone utilisé lors de vos commandes",
            "si vous en avez un, un numéro de commande, par exemple LS-260812-XXXXXXXX",
          ],
        },
        {
          title: "Ce que nous supprimons",
          paragraphs: ["Sous 30 jours, nous effaçons :"],
          bullets: [
            "votre compte client et son adresse enregistrée",
            "votre nom, votre téléphone et votre adresse de livraison",
            "vos données de navigation et d'attribution publicitaire",
            "les identifiants techniques de vos échanges WhatsApp",
          ],
        },
        {
          title: "Ce que nous devons conserver",
          paragraphs: [
            "La réglementation comptable algérienne nous impose de conserver les pièces liées aux commandes livrées et payées. Ces documents sont archivés et ne servent plus à vous contacter ni à faire de la publicité.",
          ],
        },
        {
          title: "Retirer votre consentement publicitaire",
          paragraphs: [
            "C'est immédiat et sans démarche : refusez la bannière de consentement, ou effacez les données du site dans votre navigateur. Le suivi s'arrête aussitôt, et aucun nouvel événement n'est envoyé à Meta.",
          ],
        },
        {
          title: "Supprimer vos données côté Meta",
          paragraphs: [
            "Les données déjà transmises à Meta se gèrent depuis votre compte Facebook ou Instagram, dans les paramètres « Vos informations et autorisations ». Nous n'avons pas la main sur cette suppression.",
          ],
        },
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy policy",
      updated: `Last updated: ${UPDATED}`,
      back: "Back to the shop",
      intro:
        "Lovely Step sells children's clothing in Algeria, with cash on delivery. This page describes exactly what data we collect, why, how long we keep it, and how you can have it erased.",
      sections: [
        {
          title: "Data you give us",
          paragraphs: ["To process an order we need:"],
          bullets: [
            "your first and last name",
            "your phone number, used for confirmation and delivery",
            "your wilaya, commune and, for home delivery, your address",
            "your order details: items, sizes, colours, quantities, amount",
          ],
        },
        {
          title: "No online payment",
          paragraphs: [
            "You pay cash on delivery. We never request, process or store any banking data. No card number passes through this site.",
          ],
        },
        {
          title: "Delivery",
          paragraphs: [
            "Your name, phone and address are shared with ZR Express, our carrier, solely to deliver your parcel. They serve no other purpose.",
          ],
        },
        {
          title: "WhatsApp confirmation",
          paragraphs: [
            "After your order, our confirmation agent may contact you on WhatsApp at the number provided to verify the information and your decision before shipment.",
            "The exchange runs on WhatsApp Cloud API, a Meta service. Technical identifiers, selected actions and messages required for order follow-up may be retained so your reply is processed correctly.",
          ],
        },
        {
          title: "Advertising measurement, only with your consent",
          paragraphs: [
            "If you accept the consent banner, we use the Meta Pixel and the Conversions API to understand which adverts lead to orders.",
            "If you decline, nothing loads: no Meta script, no measurement cookie, no IP address shared. Declining is the default until you choose.",
            "Data sent to Meta is hashed beforehand. We never share your name or phone number in clear text.",
          ],
        },
        {
          title: "How long we keep your data",
          paragraphs: ["Automatically enforced retention:"],
          bullets: [
            "visits and audience statistics: 180 days",
            "advertising measurement events: 180 days",
            "attribution data: 400 days",
            "orders and invoices: retained, as accounting law requires",
          ],
        },
        {
          title: "Where your data is hosted",
          paragraphs: [
            "The database and images are hosted with Supabase, on servers located in Europe. The site runs on Railway. Neither provider uses your data for their own purposes.",
          ],
        },
        {
          title: "Your rights",
          paragraphs: [
            `You may ask to access, correct or erase your data by writing to ${CONTACT}. We reply within 30 days. The erasure procedure is set out on the dedicated page.`,
          ],
        },
      ],
    },
    deletion: {
      title: "Deleting your data",
      updated: `Last updated: ${UPDATED}`,
      back: "Back to the shop",
      intro:
        "You may request deletion of the personal data Lovely Step holds about you. Here is how, and what will actually be erased.",
      sections: [
        {
          title: "How to request deletion",
          paragraphs: [`Email ${CONTACT} with:`],
          bullets: [
            "subject: “Delete my data”",
            "the phone number used for your orders",
            "an order number if you have one, for example LS-260812-XXXXXXXX",
          ],
        },
        {
          title: "What we delete",
          paragraphs: ["Within 30 days we erase:"],
          bullets: [
            "your customer account and its saved address",
            "your name, phone number and delivery address",
            "your browsing and advertising attribution data",
            "the technical identifiers of your WhatsApp exchanges",
          ],
        },
        {
          title: "What we must keep",
          paragraphs: [
            "Algerian accounting rules require us to keep records of delivered and paid orders. Those documents are archived and no longer used to contact you or for advertising.",
          ],
        },
        {
          title: "Withdrawing advertising consent",
          paragraphs: [
            "This is immediate and needs no request: decline the consent banner, or clear the site data in your browser. Tracking stops at once and no new event is sent to Meta.",
          ],
        },
        {
          title: "Deleting data held by Meta",
          paragraphs: [
            "Data already sent to Meta is managed from your Facebook or Instagram account, under “Your information and permissions”. That deletion is outside our control.",
          ],
        },
      ],
    },
  },
  ar: {
    privacy: {
      title: "سياسة الخصوصية",
      updated: `آخر تحديث: ${UPDATED}`,
      back: "العودة إلى المتجر",
      intro:
        "تبيع Lovely Step ملابس الأطفال في الجزائر مع الدفع عند الاستلام. توضّح هذه الصفحة بدقة البيانات التي نجمعها، ولماذا، ومدة الاحتفاظ بها، وكيف يمكنكم طلب حذفها.",
      sections: [
        {
          title: "البيانات التي تقدمونها",
          paragraphs: ["لمعالجة الطلب نحتاج إلى:"],
          bullets: [
            "الاسم واللقب",
            "رقم الهاتف، ويُستعمل للتأكيد والتوصيل",
            "الولاية والبلدية، والعنوان في حالة التوصيل إلى المنزل",
            "تفاصيل الطلب: المنتجات والمقاسات والألوان والكميات والمبلغ",
          ],
        },
        {
          title: "لا دفع إلكتروني",
          paragraphs: [
            "الدفع نقداً عند الاستلام. لا نطلب أي بيانات بنكية ولا نعالجها ولا نحتفظ بها. لا يمر أي رقم بطاقة عبر هذا الموقع.",
          ],
        },
        {
          title: "التوصيل",
          paragraphs: [
            "يُرسل اسمكم ورقم هاتفكم وعنوانكم إلى ZR Express، شركة التوصيل، لغرض إيصال الطرد فقط ولا شيء غير ذلك.",
          ],
        },
        {
          title: "التأكيد عبر واتساب",
          paragraphs: [
            "بعد تسجيل الطلب، قد يتواصل معكم مساعد التأكيد عبر واتساب على الرقم الذي قدمتموه للتحقق من المعلومات وقراركم قبل الشحن.",
            "يمر التبادل عبر WhatsApp Cloud API التابع لـ Meta. قد نحتفظ بالمعرّفات التقنية والإجراءات المختارة والرسائل اللازمة لمتابعة الطلب ومعالجة ردكم بشكل صحيح.",
          ],
        },
        {
          title: "قياس الإعلانات، بموافقتكم فقط",
          paragraphs: [
            "إذا قبلتم شريط الموافقة، نستعمل Meta Pixel وواجهة التحويلات لمعرفة الإعلانات التي تؤدي إلى طلبات.",
            "إذا رفضتم، لا يُحمَّل أي شيء: لا نص برمجي من Meta، ولا ملف تعريف قياس، ولا إرسال لعنوان IP. الرفض هو السلوك الافتراضي قبل اختياركم.",
            "تُشفَّر البيانات المرسلة إلى Meta قبل إرسالها. لا نرسل اسمكم ولا رقمكم بشكل ظاهر أبداً.",
          ],
        },
        {
          title: "مدة الاحتفاظ",
          paragraphs: ["المدد المطبّقة تلقائياً:"],
          bullets: [
            "الزيارات وإحصاءات الجمهور: 180 يوماً",
            "أحداث قياس الإعلانات: 180 يوماً",
            "بيانات الإسناد: 400 يوم",
            "الطلبات والفواتير: تُحفظ لأن القانون المحاسبي يفرض ذلك",
          ],
        },
        {
          title: "مكان استضافة بياناتكم",
          paragraphs: [
            "قاعدة البيانات والصور مستضافة لدى Supabase على خوادم في أوروبا، والموقع منشور على Railway. لا يستعمل هذان المزوّدان بياناتكم لحسابهما.",
          ],
        },
        {
          title: "حقوقكم",
          paragraphs: [
            `يمكنكم طلب الاطلاع على بياناتكم أو تصحيحها أو حذفها بمراسلتنا على ${CONTACT}. نردّ خلال 30 يوماً. إجراء الحذف مفصّل في الصفحة المخصصة له.`,
          ],
        },
      ],
    },
    deletion: {
      title: "حذف بياناتكم",
      updated: `آخر تحديث: ${UPDATED}`,
      back: "العودة إلى المتجر",
      intro:
        "يمكنكم طلب حذف البيانات الشخصية التي تحتفظ بها Lovely Step عنكم. إليكم الطريقة وما سيُحذف فعلياً.",
      sections: [
        {
          title: "كيفية طلب الحذف",
          paragraphs: [`أرسلوا بريداً إلكترونياً إلى ${CONTACT} يتضمن:`],
          bullets: [
            "الموضوع: «حذف بياناتي»",
            "رقم الهاتف المستعمل في طلباتكم",
            "رقم طلب إن توفّر، مثل LS-260812-XXXXXXXX",
          ],
        },
        {
          title: "ما نحذفه",
          paragraphs: ["خلال 30 يوماً نحذف:"],
          bullets: [
            "حسابكم والعنوان المحفوظ فيه",
            "اسمكم ورقم هاتفكم وعنوان التوصيل",
            "بيانات التصفح وإسناد الإعلانات",
            "المعرّفات التقنية لمراسلاتكم عبر واتساب",
          ],
        },
        {
          title: "ما يجب علينا الاحتفاظ به",
          paragraphs: [
            "تفرض القواعد المحاسبية الجزائرية الاحتفاظ بوثائق الطلبات المسلَّمة والمدفوعة. تُؤرشف هذه الوثائق ولا تُستعمل بعد ذلك للتواصل معكم ولا للإعلان.",
          ],
        },
        {
          title: "سحب الموافقة على الإعلانات",
          paragraphs: [
            "فوري ولا يتطلب أي إجراء: ارفضوا شريط الموافقة، أو امسحوا بيانات الموقع من متصفحكم. يتوقف التتبع فوراً ولا يُرسل أي حدث جديد إلى Meta.",
          ],
        },
        {
          title: "حذف البيانات لدى Meta",
          paragraphs: [
            "تُدار البيانات المرسلة سابقاً إلى Meta من حسابكم على فيسبوك أو إنستغرام، في إعدادات «معلوماتك وأذوناتك». هذا الحذف خارج عن سيطرتنا.",
          ],
        },
      ],
    },
  },
};

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const { locale, t, dir } = useLocale();
  const page = content[locale][kind];

  return <div className="product-page legal-page" dir={dir}>
    <header className="product-header">
      <Link href="/" className="brand"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={96} height={96} /></Link>
      <Link href="/" className="header-cart">{page.back}</Link>
    </header>

    <main>
      <article className="legal-content">
        <h1>{page.title}</h1>
        <p className="legal-updated">{page.updated}</p>
        <p className="legal-intro">{page.intro}</p>

        {page.sections.map((section) => <section key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
        </section>)}
      </article>
    </main>

    <footer>
      <Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={120} height={120} />
      <p>Tiny Steps, Big Love</p>
      <small>© {new Date().getFullYear()} Lovely Step. {t("rights")}</small>
      <small>{t("legalEntity")}</small>
      <nav className="legal-links">
        <Link href="/confidentialite">{t("privacy")}</Link>
        <Link href="/suppression-donnees">{t("dataDeletion")}</Link>
        <Link href="/mentions-legales">{t("legalNotices")}</Link>
      </nav>
    </footer>
  </div>;
}
