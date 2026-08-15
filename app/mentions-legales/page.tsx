import Image from "next/image";
import Link from "next/link";

export default function LegalNoticesPage() {
  return <div className="product-page legal-page">
    <header className="product-header">
      <Link href="/" className="brand"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={96} height={96} /></Link>
      <Link href="/" className="header-cart">Retour à la boutique</Link>
    </header>

    <main>
      <article className="legal-content">
        <h1>Mentions légales</h1>
        <p className="legal-intro">Lovely Step est le nom commercial de l’entreprise individuelle Benyagoub Ameur.</p>

        <section>
          <h2>Identité de l’entreprise</h2>
          <p><strong>Nom légal :</strong> Benyagoub Ameur</p>
          <p><strong>Nom commercial :</strong> Lovely Step</p>
          <p><strong>Site officiel :</strong> lovelystep.com</p>
        </section>

        <section>
          <h2>Activité</h2>
          <p>Commerce en ligne de vêtements pour enfants en Algérie, avec paiement à la livraison.</p>
        </section>
      </article>
    </main>

    <footer>
      <Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={120} height={120} />
      <p>Tiny Steps, Big Love</p>
      <small>© {new Date().getFullYear()} Lovely Step. Tous droits réservés.</small>
      <small>Lovely Step est le nom commercial de l’entreprise individuelle Benyagoub Ameur.</small>
      <nav className="legal-links"><Link href="/confidentialite">Confidentialité</Link><Link href="/suppression-donnees">Suppression des données</Link></nav>
    </footer>
  </div>;
}
