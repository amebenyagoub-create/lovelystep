# Agent de confirmation WhatsApp — mode gratuit

## Parcours retenu

Lovely Step n’envoie pas le premier message. Après sa commande, le client clique sur **Confirmer sur WhatsApp** et envoie le texte prérempli. Cette action ouvre la fenêtre de service client. L’agent répond alors avec la photo réelle du premier article, le récapitulatif et les boutons **Confirmer** / **Ne pas confirmer**.

Le mode gratuit désactive volontairement les rappels automatiques et les notifications proactives après la fenêtre de 24 heures. Ces messages nécessiteraient des modèles approuvés et pourraient être facturés par Meta.

## Configuration Meta

1. Créer ou ouvrir une application de type Business dans Meta Developers.
2. Ajouter le produit **WhatsApp** et connecter le numéro WhatsApp Business.
3. Copier l’identifiant du numéro et créer un jeton d’accès adapté à la production.
4. Configurer les variables `WHATSAPP_*` décrites dans `.env.example`.
5. Dans la configuration Webhooks de WhatsApp, utiliser l’URL affichée dans **Administration → WhatsApp** et le même `WHATSAPP_VERIFY_TOKEN`.
6. S’abonner au champ `messages`.

Le serveur refuse tout webhook dont la signature `x-hub-signature-256` ne correspond pas au secret de l’application Meta.

## Comportement

- Chaque message entrant possède un identifiant unique enregistré en base. Une livraison répétée du webhook ne change donc pas deux fois la commande et ne renvoie pas deux réponses.
- Le numéro WhatsApp doit correspondre au numéro enregistré sur la commande.
- Une confirmation change le statut en `confirmed`.
- Un refus demande un seul motif. Le motif prix reçoit au maximum une proposition : conserver au prix réel ou annuler.
- Une annulation libère le stock réservé.
- Taille, couleur, livraison et doublon restent `to_confirm` afin qu’un humain effectue une modification sûre depuis l’administration.
- Le choix « Pas maintenant » n’entraîne aucun rappel payant. Le client peut réutiliser son lien plus tard.

## Endpoint

- Vérification Meta : `GET /api/whatsapp/webhook`
- Messages entrants : `POST /api/whatsapp/webhook`

## Données sensibles

Les jetons et secrets restent uniquement dans l’environnement serveur. Les erreurs journalisées ne contiennent jamais le jeton d’accès. Le système conserve les identifiants techniques nécessaires à l’idempotence, l’action choisie, la commande associée et l’identifiant de la réponse Meta ; il ne duplique pas le contenu complet du webhook en base.
