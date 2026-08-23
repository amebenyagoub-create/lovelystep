# Confirmation WhatsApp — hors de ce dépôt

L'agent de confirmation WhatsApp **ne fait plus partie de la boutique**. Il tourne
comme un service séparé (projet Railway `cod-agent`) et parle au même numéro
expéditeur. Le panneau interne, le webhook `/api/whatsapp/webhook` et
`lib/whatsapp/*` ont été supprimés le 23 août 2026 : deux robots branchés sur le
même WABA auraient répondu deux fois au même client.

## Frontière entre les deux systèmes

| | Boutique | Agent |
|---|---|---|
| Écrit la commande dans le Google Sheet | ✅ | |
| Envoie les messages WhatsApp | | ✅ |
| Crée le colis ZR Express | (bouton admin, à éviter) | ✅ |
| Suit les états de livraison | | ✅ |
| Relit les états depuis le Sheet | ✅ | |
| Grille tarifaire ZR (lecture seule) | ✅ | |

Le Google Sheet est le seul point de contact. La boutique y écrit une ligne par
commande (colonne `state`), l'agent la lit, mène la conversation, puis réécrit
`state`. `/api/cron/sheet-sync` fait circuler l'information dans les deux sens.

## À vérifier côté Meta

Un seul appli abonnée au WABA `2107937583135062` : **`agent commande`**
(`930120029651651`). Toute autre application abonnée recevrait aussi les messages
entrants.

## Vocabulaire d'états

`SHEET_STATES` dans `lib/google-sheets.ts` doit couvrir les 19 états de l'agent.
Un état inconnu n'est plus silencieux : il remonte dans le tableau de bord et
dans les journaux sous `ACTION_REQUIRED.sheet_states_unknown`.
