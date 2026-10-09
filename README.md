# R2 → Buffer : Facebook Reels, Instagram Reels et YouTube Shorts

Ce projet automatise les vidéos MP4 du bucket Cloudflare R2 `reels` vers **une page Facebook, Instagram et YouTube**, via Buffer. TikTok a été remplacé par Facebook pour les nouveaux posts.

## Fréquence des publications (fuseau Africa/Casablanca)

| Réseau | Cadence | Nombre de posts programmés d'avance |
| --- | --- | --- |
| Facebook Reels | Une vidéo par heure, à la minute 00 | 8 |
| Instagram Reels | Une vidéo par heure, à la minute 00 | 8 |
| YouTube Shorts | 4 par jour : 00h, 06h, 12h, 18h (à partir du lendemain) | 8 |

GitHub Actions vérifie la file toutes les 5 heures environ. Les posts déjà programmés sont comptabilisés avant tout nouvel envoi, et les vidéos sont identifiées de manière stable pour éviter les doublons. Buffer publie aux horaires `dueAt` même lorsque GitHub Actions n'est pas actif.

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
- `src/queue-schedule.js` génère pour Facebook les mêmes créneaux horaires qu'Instagram.
- `src/sync-run.js` remplit la file de ces trois réseaux et conserve les protections existantes contre les appels excessifs.
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
