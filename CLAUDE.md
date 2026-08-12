@AGENTS.md

## Suivi Meta et rentabilité

Documentation : `docs/meta/META_INTEGRATION.md` (point d'entrée).

Règles à respecter dans ce domaine :

- **Ne jamais lire la base dans `app/layout.tsx`.** Le layout racine enveloppe les routes
  prérendues, donc `next build` exécuterait la lecture et migrerait la base pointée par
  `DATABASE_URL`. C'est déjà arrivé. Le suivi boutique vit dans `app/store-tracking.tsx`,
  monté uniquement par les pages `force-dynamic`. Un garde-fou dans `ensureDatabase()` bloque
  toute migration pendant le build.
- **`.env.local` pointe sur la base de production.** Toute commande qui démarre l'application
  peut l'atteindre. Les tests utilisent des schémas temporaires `ls_*` et ne touchent jamais
  `public`.
- **Argent = entiers en unités mineures** (centimes DZD). Jamais de flottant.
- **Division protégée** : `ratio`/`percent`/`perUnitMinor` de `lib/finance/money.ts` renvoient
  `null`, jamais `Infinity` ni `NaN`.
- **Donnée manquante ≠ zéro.** Un coût absent est signalé par le rapport de complétude ; une
  dépense non convertible met à `null` toutes les métriques qui en dépendent.
- **Revenu reconnu = commandes livrées.** L'événement Meta `Purchase` part à la commande
  passée : les deux chiffres diffèrent volontairement et ne se comparent pas.
- **`actions` / `action_values` se lisent par `action_type`**, jamais par position.
- **`content_ids` et l'`id` du catalogue viennent tous deux de `contentId()`.** Toute
  divergence casse le rapprochement événements ↔ catalogue.
- **Sans consentement : aucun suivi.** Ni Pixel, ni CAPI, ni attribution, ni lecture d'IP.
- **Aucune donnée personnelle** dans `meta_events`, `meta_attribution` ni dans les journaux ;
  les erreurs passent par `redact()`.
- **Un échec de suivi ne bloque jamais une commande** : tout part dans `after()`.
- **Version Graph API épinglée** (`META_GRAPH_API_VERSION`, défaut v26.0). À revérifier
  chaque trimestre sur le changelog Meta, jamais de mémoire.

Tests : `npm run test:all` (sans base) ; `test:finance`, `test:meta`, `test:meta-ads`,
`test:privacy` nécessitent `TEST_DATABASE_URL`.
