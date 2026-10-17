# R2 → Buffer : Facebook Reels, Instagram Reels et YouTube Shorts

Ce projet automatise les vidéos MP4 du bucket Cloudflare R2 `reels` vers **une page Facebook, Instagram et YouTube**, via Buffer. TikTok a été remplacé par Facebook pour les nouveaux posts.

## Fréquence des publications (fuseau Africa/Casablanca)

| Réseau | Cadence | Réserve programmée |
| --- | --- | --- |
| Facebook Reels | **12 vidéos par jour**, horaires variables | 8 |
| Instagram Reels | **12 vidéos par jour**, horaires variables | 8 |
| YouTube Shorts | 4 vidéos par jour, horaires variables | 8 |

Pour **Facebook et Instagram**, chaque jour comporte **12 plages de deux heures** (00h–01h55, 02h–03h55, ... 22h–23h55), avec **un horaire pseudo-aléatoire par plage**, choisi par pas de 5 minutes. Chaque réseau a des horaires distincts. Les horaires varient d'un jour à l'autre, mais restent stables pour une date et un réseau donnés : une nouvelle synchronisation ne mélange pas les créneaux déjà prévus.

Pour YouTube, les **quatre plages précédentes** restent : 01h–04h55, 07h–10h55, 13h–16h55 et 19h–22h55.

Le fuseau `Africa/Casablanca` est appliqué, y compris lors des changements d'heure. Les créneaux encore futurs du **jour en cours** restent disponibles pour le réapprovisionnement, plutôt que de patienter systématiquement jusqu'au lendemain.

Les anciennes vidéos programmées par le bot peuvent être déplacées **par édition**, sans nouvel envoi ni doublon, vers les créneaux désormais valides. Les publications externes restent inchangées. Aucun nouveau quiz Facebook n'est généré.

GitHub Actions vérifie les files **toutes les deux heures** environ. Le bot maintient une réserve de **8 vidéos programmées par réseau**, volontairement inférieure à la limite de **10 posts programmés** rencontrée précédemment dans Buffer. Le nombre de vidéos en réserve n'est **pas** la cadence quotidienne : le réapprovisionnement régulier permet de publier jusqu'à 12 vidéos par jour sur Facebook et Instagram. Buffer peut toujours refuser des vidéos non conformes ou imposer ses propres limites.

## Configuration GitHub

Dans **Settings → Secrets and variables → Actions** :

| Type | Nom | Signification |
| --- | --- | --- |
| Secret | `BUFFER_API_KEY` | Clé API Buffer |
| Variable | `BUFFER_ORGANIZATION_ID` | Organisation Buffer |
| Variable | `BUFFER_FACEBOOK_CHANNEL_ID` | ID Buffer de la **page Facebook** connectée |
| Variable | `BUFFER_INSTAGRAM_CHANNEL_ID` | ID du compte Instagram |
| Variable | `BUFFER_YOUTUBE_CHANNEL_ID` | ID de la chaîne YouTube |
| Variable | `R2_PUBLIC_BASE_URL` | URL publique des vidéos |
| Variable | `R2_ACCOUNT_ID` | Identifiant du compte Cloudflare R2 |
| Variable | `R2_BUCKET_NAME` | Nom du bucket, `reels` par défaut |
| Variable | `R2_PREFIX` | Sous-dossier éventuel |
| Secret | `R2_ACCESS_KEY_ID` | Identifiant S3 R2 avec accès lecture |
| Secret | `R2_SECRET_ACCESS_KEY` | Secret S3 R2 |

Les chaînes Buffer sont détectées automatiquement lorsqu'une seule chaîne de chaque réseau existe. Dans le cas contraire, renseigner leur ID.

## Fonctionnement

- `src/catalog.js` liste les MP4 et construit les destinations Facebook, Instagram et YouTube. Il remplace les anciennes destinations TikTok dans le catalogue mis en cache.
- `src/core.js` précise `metadata.facebook.type = 'reel'` pour les publications Facebook.
- `src/queue-schedule.js` génère 12 horaires quotidiens pour Facebook et Instagram, 4 pour YouTube (heure du Maroc).
- `src/sync-run.js` remplit Facebook, Instagram et YouTube et conserve les protections contre les appels excessifs.
- `state.json` conserve les checkpoints, les identifiants Buffer et les compteurs R2. Ne pas le remettre à zéro pour reprogrammer une vidéo : risque de doublons.

Les **anciennes vidéos TikTok déjà prévues dans Buffer restent programmées** : cette modification arrête seulement la création de nouveaux posts TikTok.

## Utilisation

La planification ordinaire se lance par `.github/workflows/publish.yml`. Le workflow `sync-now.yml` permet une synchronisation manuelle via `.github/requests/sync.json`. Le workflow `publish-now.yml` permet une publication immédiate via `.github/requests/publish-now.json`.

Pour tester en local avec Node.js 24 :

```bash
npm ci --ignore-scripts
npm test
node --env-file=.env src/run.js --dry-run
```

Copier `.env.example` vers `.env` pour l'exécution locale, sans jamais committer les secrets.

**Attention** : accepter un Reel dans la file Buffer ne garantit ni la publication finale par Facebook ni l'éligibilité à la monétisation.
