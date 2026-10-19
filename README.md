# R2 → Buffer : deux pages Facebook Reels et Instagram Reels

Ce dépôt automatise les vidéos MP4 du bucket Cloudflare R2 `reels` vers **deux pages Facebook et un compte Instagram** via Buffer. **Aucune nouvelle vidéo YouTube ou TikTok** n'est créée par la synchronisation.

## Cadence (Africa/Casablanca)

| Destination | Vidéos par jour | Réserve Buffer |
| --- | ---: | ---: |
| Facebook 1 (`6ac8cdf16a5c39ccb6602776`) | 12 | 10 |
| Facebook 2 (`6ad65667778b240e2f5bb5bc`) | 12 | 10 |
| Instagram | 12 | 10 |

Chaque compte dispose de ses **propres créneaux horaires et checkpoints**, ce qui empêche qu'une vidéo ajoutée à Facebook 1 soit considérée comme déjà envoyée à Facebook 2. Les horaires sont pseudo-aléatoires, par pas de 5 minutes, avec une publication dans chacune des 12 tranches de deux heures, et restent stables pour un jour et un compte donnés. L'heure marocaine et ses changements saisonniers sont pris en compte.

Le workflow ordinaire fonctionne environ **toutes les six heures** et complète chaque file à 10 vidéos. La cadence de 12 vidéos/jour dépend des limites et de la publication effective par Buffer et Facebook ; une vidéo acceptée dans la file n'est pas nécessairement publiée.

## Configuration

Dans **Settings → Secrets and variables → Actions** :

| Type | Nom | Utilisation |
| --- | --- | --- |
| Secret | `BUFFER_API_KEY` | Clé API Buffer |
| Variable | `BUFFER_ORGANIZATION_ID` | Organisation Buffer |
| Variable | `BUFFER_INSTAGRAM_CHANNEL_ID` | Compte Instagram |
| Variable | `BUFFER_FACEBOOK_CHANNEL_ID` | Ancien identifiant Facebook, si utilisé ailleurs |
| Variable | `R2_PUBLIC_BASE_URL` | URL publique des vidéos |
| Variable | `R2_ACCOUNT_ID` | Identifiant de compte R2 |
| Variable | `R2_BUCKET_NAME` | Bucket R2 (`reels` par défaut) |
| Variable | `R2_PREFIX` | Préfixe R2 optionnel |
| Secret | `R2_ACCESS_KEY_ID` | Accès R2 en lecture |
| Secret | `R2_SECRET_ACCESS_KEY` | Secret R2 |

Les workflows du dépôt définissent déjà `BUFFER_FACEBOOK_CHANNEL_IDS` avec les deux IDs ci-dessus. Pour lancer le bot localement, renseigner cette variable dans `.env` :

```dotenv
BUFFER_FACEBOOK_CHANNEL_IDS=6ac8cdf16a5c39ccb6602776,6ad65667778b240e2f5bb5bc
```

L'API Buffer doit voir ces deux pages ainsi que le compte Instagram dans **la même organisation**. Une page en pause, déconnectée ou verrouillée n'est pas remplie automatiquement.

## Exécution

- `.github/workflows/publish.yml` : synchronisation à 00:17, 06:17, 12:17 et 18:17 UTC (filtre de six heures depuis la dernière tentative). Dans **Actions → Run workflow**, cocher `dry_run` pour une simulation sans envoi.
- `.github/workflows/sync-now.yml` : synchronisation demandée en changeant l'ID dans `.github/requests/sync.json` (vrai envoi).
- `.github/workflows/publish-now.yml` : vidéo immédiate sur les **trois comptes** en changeant la demande dans `.github/requests/publish-now.json`.
- `src/discovery.js` : sélection des trois chaînes.
- `src/queue.js` et `src/queue-schedule.js` : files et créneaux indépendants.
- `src/checkpoints.js` : migration prudente des anciennes clés Facebook.
- `state.json` : suivi historique. **Ne pas supprimer ni réinitialiser ce fichier** sous peine de risquer des doublons.

Les anciennes publications YouTube et TikTok ne sont pas supprimées automatiquement sur Buffer : seuls les **nouveaux envois** sont arrêtés.

### Tests locaux (Node.js 24)

```bash
npm ci --ignore-scripts
npm test
node --env-file=.env src/run.js --dry-run
```

Les tests incluent la séparation des deux pages Facebook, les anciennes publications et l'idempotence de la publication immédiate. `.env` et les clés API doivent rester hors Git.
