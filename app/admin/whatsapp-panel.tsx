type WhatsAppStatus = {
  businessNumberConfigured: boolean;
  graphApiVersion: string;
  messagingConfigured: boolean;
  ready: boolean;
  webhookConfigured: boolean;
  webhookUrl: string;
};

function Check({ ready, label, help }: { ready: boolean; label: string; help: string }) {
  return <li className={ready ? "ready" : "missing"}><span>{ready ? "✓" : "!"}</span><div><strong>{label}</strong><small>{help}</small></div></li>;
}

export default function WhatsAppPanel({ status }: { status: WhatsAppStatus }) {
  return <div className="whatsapp-admin-layout">
    <section className="admin-card whatsapp-admin-hero">
      <span className="admin-kicker">Confirmation sans abonnement</span>
      <h2>Agent WhatsApp</h2>
      <p>Le client ouvre lui-même WhatsApp depuis la page de commande. L’agent lui présente ensuite la photo, le récapitulatif et les boutons de confirmation dans la fenêtre gratuite.</p>
      <strong className={status.ready ? "whatsapp-ready" : "whatsapp-not-ready"}>{status.ready ? "● Agent prêt" : "● Configuration à terminer"}</strong>
    </section>
    <section className="admin-card">
      <div className="card-title"><div><h2>Connexion Meta</h2><p>Les secrets restent uniquement dans l’environnement du serveur.</p></div></div>
      <ul className="whatsapp-checklist">
        <Check ready={status.businessNumberConfigured} label="Numéro WhatsApp Business" help="Utilisé par le bouton affiché après la commande." />
        <Check ready={status.webhookConfigured} label="Webhook sécurisé" help="Jeton de vérification et secret de l’application Meta." />
        <Check ready={status.messagingConfigured} label="Réponses automatiques" help={`Identifiant du numéro, jeton d’accès et Graph API ${status.graphApiVersion}.`} />
      </ul>
      <label className="whatsapp-webhook-label">URL de rappel à copier dans Meta<input readOnly value={status.webhookUrl || "Configurez d’abord SITE_URL avec le domaine public."} onFocus={(event) => event.currentTarget.select()} /></label>
      <p className="whatsapp-free-note"><b>Mode gratuit actif :</b> aucun premier message automatique, aucun rappel payant et aucune relance après la fenêtre gratuite de 24 h.</p>
    </section>
  </div>;
}
