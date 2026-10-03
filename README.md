# Shorts → R2 → Buffer

Node.js 24 sans dépendances. Une vidéo par passage, matin et soir, sur TikTok, YouTube Shorts et Instagram Reels. Facebook peut être ajouté. Le projet n'est pas connecté aux comptes : le post d'exemple est désactivé.

## Configuration

1. Téléverser les MP4 dans un bucket Cloudflare R2 Standard. Configurer un domaine public. Les URL doivent renvoyer directement les vidéos sans connexion avec `Content-Type: video/mp4`. Une URL publique `r2.dev` convient aux tests mais est limitée ; préférer un domaine personnalisé pour la production. Garder les vidéos accessibles jusqu'à leur publication effective. Ce projet ne supprime pas de fichiers.
2. Connecter TikTok, YouTube et Instagram dans Buffer et configurer deux créneaux de publication quotidiens pour chaque chaîne, après les passages GitHub. Le script ajoute à la file avec `addToQueue`. Buffer détermine l'heure de publication selon les créneaux et les posts déjà présents.
3. Dans GitHub → Settings → Secrets and variables → Actions, ajouter les paramètres suivants.

| Type | Nom | Valeur |
| --- | --- | --- |
| Secret | `BUFFER_API_KEY` | Clé API Buffer |
| Variable | `BUFFER_ORGANIZATION_ID` | Organisation Buffer pour lister les chaînes |
| Variable | `BUFFER_TIKTOK_CHANNEL_ID` | ID TikTok |
| Variable | `BUFFER_YOUTUBE_CHANNEL_ID` | ID YouTube |
| Variable | `R2_PUBLIC_BASE_URL` | Exemple : `https://videos.example.com` |
| Variable | `BUFFER_FACEBOOK_CHANNEL_ID` | Facultatif |
| Variable | `BUFFER_INSTAGRAM_CHANNEL_ID` | ID Instagram |

Aucune clé R2 n'est nécessaire : le script transmet les URL publiques. Ne pas mettre la clé Buffer dans le code. Le workflow doit pouvoir écrire sur la branche par défaut ; une protection interdisant les commits du bot bloque les checkpoints et donc les envois.

Pour découvrir les chaînes en local, copier `.env.example` vers `.env`, remplir la clé et l'organisation :

```bash
node --env-file=.env src/channels.js
```

## Posts

Modifier `posts.json`. Les vidéos sont prises dans l'ordre. Mettre `enabled: true` uniquement quand le contenu est prêt. Garder un ID unique permanent par vidéo.

```json
[
  {
    "id": "short001",
    "enabled": true,
    "file": "short001.mp4",
    "title": "Titre du Short",
    "text": "Description #shorts",
    "platforms": ["tiktok", "youtube", "instagram"],
    "youtube": { "categoryId": "22", "madeForKids": false, "privacy": "public" },
    "isAiGenerated": false
  }
]
```

`file` doit correspondre au nom de l'objet R2. `url` peut remplacer `file` pour utiliser une URL HTTPS directe. Si `title` est absent ou vide, le titre YouTube vient automatiquement du nom du fichier vidéo : extension retirée, `_` remplacés par des espaces, espaces superflus supprimés, limite de 100 caractères. Pour une URL directe, le nom est récupéré dans son chemin et décodé. Exemple : `Les_bienfaits_du_miel.mp4` → `Les bienfaits du miel`. Un titre personnalisé dans `title` (ou `youtube.title`) reste prioritaire et doit respecter les 100 caractères. Si `text` est vide, ce titre sert également de légende. Il s'agit du nom du fichier, pas d'une lecture du texte affiché dans la vidéo ni de ses métadonnées internes. Adapter catégorie, public enfant et déclaration de contenu IA au contenu réel. Les formats et limites propres aux réseaux et au plan Buffer continuent de s'appliquer. Une vidéo sur les trois réseaux crée trois posts Buffer. Instagram est envoyé au format Reel, également partagé dans le fil. `queued` signifie ajouté à Buffer, pas publié avec succès : surveiller les erreurs de publication dans Buffer.

Pour générer le manifeste des 500 vidéos d'un dossier local :

```bash
npm run manifest -- /chemin/vers/videos
```

Le résultat `posts.generated.json` contient des entrées désactivées à relire et compléter. Il ne téléverse pas les vidéos et refuse d'écraser un fichier existant. Après vérification et activation, l'utiliser comme `posts.json`.

## Tests et exécution

```bash
npm test
node --env-file=.env src/run.js --dry-run
```

La simulation n'appelle pas Buffer et ne vérifie pas l'accès réseau R2. Dans Actions → Envoyer les Shorts à Buffer → Run workflow, laisser `dry_run` coché pour simuler ; décocher pour un envoi réel.

Le workflow passe à **07:17 et 19:17 UTC**, horaires fixes : leur équivalent local dépend du fuseau. GitHub peut retarder ou manquer un lancement. Chaque passage traite une vidéo au maximum, sans rattrapage massif. Les heures réelles de publication se règlent dans Buffer. Une relance manuelle dans le même demi-jour UTC ne sélectionne pas une deuxième vidéo si la première a réussi. La planification doit être sur la branche par défaut. GitHub peut désactiver les planifications des dépôts publics inactifs.

## Suivi et récupération

`state.json` garde le suivi par vidéo/réseau. Le script commit et push un checkpoint avant chaque appel, puis son résultat après l'appel. Ne pas effacer le suivi ou changer les IDs déjà utilisés.

- `queued` : ajouté à Buffer, ignoré aux relances.
- `rejected` : refus explicite de Buffer. Corriger la cause puis relancer. Les réseaux ayant réussi sont ignorés.
- `sending` ou `uncertain` : résultat inconnu après interruption. Les nouveaux envois sont bloqués pour éviter un doublon.

Pour débloquer : vérifier la file et l'historique Buffer du réseau concerné. Si le post existe, mettre son entrée à `queued` et renseigner son `bufferId`. Si son absence est confirmée, supprimer uniquement cette entrée dans `deliveries`. Commit et relancer. Les clés sont des paires encodées en JSON : `["short001","tiktok"]`. Ne jamais supprimer une entrée incertaine sans vérification.

GitHub et Buffer ne partagent pas de transaction. La stratégie privilégie le blocage et la vérification humaine en cas d'ambiguïté. Un conflit lors d'un push ou un échec API rend le workflow rouge. L'exécution locale réelle modifie seulement le suivi local ; utiliser GitHub Actions pour la production et éviter les exécutions réelles simultanées hors workflow.

## Documentation officielle

- [Vidéos Buffer](https://developers.buffer.com/examples/create-video-post.html)
- [Hébergement des médias](https://developers.buffer.com/guides/hosting-media.html)
- [YouTube](https://developers.buffer.com/types/YoutubePostMetadataInput.html)
- [R2 public](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Protection des accès Cloudflare R2

Le script utilise l'URL publique R2, sans clé Cloudflare, sans upload, suppression ou liste du bucket. Avant un envoi à Buffer, il fait uniquement une requête `HEAD` pour vérifier la vidéo.

Cette vérification est limitée à **1 appel par exécution et 4 appels par jour UTC**, toutes URL vidéo confondues. Le compteur `mediaRequests` est commit/push dans `state.json` avant l'appel : les erreurs et relances manuelles comptent aussi. Au moins 10 secondes doivent séparer deux vérifications. Il n'y a aucune nouvelle tentative ou redirection automatique. Une réponse HTTP 429 stoppe le workflow et suspend les vérifications au moins une heure, ou davantage si `Retry-After` l'exige.

Un passage normal fait une seule vérification pour les trois réseaux ; deux passages font donc deux requêtes du script par jour. Buffer et les réseaux téléchargent ensuite les vidéos de leur côté : ces accès externes ne sont pas plafonnés par ce compteur. Les simulations et créneaux déjà envoyés ne font aucune vérification. Ne pas supprimer le compteur pour contourner la limite. La persistance des limites dépend de la conservation de `state.json` et du workflow sérialisé ; éviter les exécutions locales simultanées.
