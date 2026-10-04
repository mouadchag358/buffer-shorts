# R2 → Buffer : TikTok, YouTube Shorts, Instagram Reels

Le workflow lit automatiquement les vidéos MP4 du bucket R2 `reels`, génère `posts.json`, récupère les comptes liés à Buffer et programme une vidéo sur les trois réseaux à **23 h et 01 h, fuseau Africa/Casablanca**. Le titre vient du nom du fichier vidéo : extension retirée, `_` remplacés par des espaces et limite de 100 caractères. La légende contient ce titre suivi de `#fyp #fy #viral #ai`. Les noms servent aussi à conserver les IDs stables. Il ne s'agit pas d'une extraction des métadonnées internes ni du texte affiché dans la vidéo.

## Paramètres GitHub

Dans Settings → Secrets and variables → Actions :

| Type | Nom | Valeur |
| --- | --- | --- |
| Secret | `BUFFER_API_KEY` | Clé Buffer déjà configurée |
| Secret | `R2_ACCESS_KEY_ID` | ID de clé API S3 R2 avec accès aux objets en lecture |
| Secret | `R2_SECRET_ACCESS_KEY` | Secret correspondant à cette clé R2 |
| Variable | `R2_PUBLIC_BASE_URL` | URL publique R2 déjà configurée |
| Variable | `R2_ACCOUNT_ID` | Facultatif : compte Cloudflare configuré dans le workflow |
| Variable | `R2_BUCKET_NAME` | Facultatif, `reels` par défaut |
| Variable | `R2_PREFIX` | Facultatif : sous-dossier à lire |
| Variable | `BUFFER_ORGANIZATION_ID` | Facultatif, nécessaire si plusieurs organisations Buffer |
| Variable | `BUFFER_TIKTOK_CHANNEL_ID` | Facultatif, nécessaire si plusieurs comptes TikTok |
| Variable | `BUFFER_YOUTUBE_CHANNEL_ID` | Facultatif, nécessaire si plusieurs comptes YouTube |
| Variable | `BUFFER_INSTAGRAM_CHANNEL_ID` | Facultatif, nécessaire si plusieurs comptes Instagram |

Créer la clé S3 dans Cloudflare R2 → Manage R2 API Tokens, avec **Object Read only** pour le bucket `reels`. Les deux valeurs R2 sont des secrets GitHub. L'URL publique seule ne permet pas de lister les objets. Les IDs Buffer sont récupérés avec la clé API ; le script refuse de choisir silencieusement entre plusieurs comptes d'un même réseau.

## Horaires

GitHub lance la préparation à **22:17 et 00:17**, heure du Maroc, pour programmer la prochaine publication à **23:00 ou 01:00**. `customScheduled` et `dueAt` sont transmis à Buffer : ces horaires ne dépendent pas du calendrier de la file Buffer. Le fuseau suit les changements d'heure du Maroc. Les horaires restent des cibles de programmation ; Buffer et les réseaux peuvent publier avec retard.

GitHub peut retarder ou manquer un lancement. Les exécutions planifiées ne préparent qu'un créneau situé entre 10 et 90 minutes dans le futur : les créneaux manqués ne sont pas envoyés en rafale. Une relance manuelle prépare le prochain créneau situé au moins 10 minutes dans le futur. Le suivi par date/créneau empêche de sélectionner une autre vidéo quand ce créneau est déjà programmé.

## Catalogue automatique

Les MP4 sont triés par nom. Le nom complet de l'objet détermine un ID stable : l'ajout d'une vidéo ne change pas les IDs des autres. Le catalogue est mis en cache une fois par jour UTC dans `state.json`. `posts.json` est généré et commit automatiquement, avec des entrées actives pour les trois réseaux. Il n'est plus nécessaire de l'éditer manuellement ; les modifications manuelles peuvent être écrasées par la synchronisation.

Les fichiers sont considérés prêts à publier dès qu'ils sont dans le bucket ou le préfixe choisi. Ne placer à cet endroit que les vidéos destinées aux trois réseaux. Les titres personnalisés restent limités à 100 caractères. Le hashtag `#ai` ne remplace pas les déclarations de contenu IA exigées par les réseaux. Les valeurs YouTube par défaut sont catégorie People & Blogs (`22`), public, non destiné aux enfants et contenu IA non déclaré. Adapter `postsFromKeys` dans `src/catalog.js` si le contenu nécessite d'autres déclarations.

Une page de 1000 objets maximum est lue. Si le bucket contient davantage d'objets, le script s'arrête sans pagination : utiliser `R2_PREFIX` pour réduire le périmètre. Les vidéos restent sur R2 ; le runner ne les télécharge pas. Conserver les URL publiques jusqu'à la publication effective. Le projet ne supprime pas les vidéos.

## Limites Cloudflare

- Listing : **2 tentatives maximum par jour UTC**, sans nouvelle tentative automatique, sans pagination ; cache après succès. Une erreur compte comme tentative. HTTP 429 impose une pause d'une heure.
- Vérification vidéo par `HEAD` : **1 par exécution, 4 par jour UTC**, sans nouvelle tentative ni redirection automatique ; HTTP 429 impose au moins une heure de pause ou davantage selon `Retry-After`.
- Compteurs commit/push avant chaque appel, intervalle minimum de 10 secondes pour chaque type de requête.

Le maximum du script est donc 2 listings + 4 vérifications par jour UTC. En usage normal : un listing et deux vérifications (parfois deux listings autour de minuit UTC). Les téléchargements de Buffer et des réseaux restent indépendants de ces limites. Ne pas effacer les compteurs ni lancer plusieurs exécutions locales simultanées.

## Essai

Actions → Envoyer les Shorts à Buffer → Run workflow. Le choix `dry_run` est activé par défaut : le script lit R2 et les comptes Buffer, actualise le catalogue et les compteurs, vérifie aussi l’URL publique de la prochaine vidéo, mais ne crée aucun post Buffer. Une modification du fichier du workflow lance également cette simulation de connexion automatiquement. Décocher pour programmer réellement. Le workflow doit pouvoir commit/push sur la branche par défaut.

En local avec Node.js 24 :

```bash
npm ci --ignore-scripts
npm test
node --env-file=.env src/run.js --dry-run
```

Copier `.env.example` vers `.env` et renseigner les valeurs, sans commit des secrets. Les essais locaux ne doivent pas se chevaucher avec le workflow de production.

## Suivi et incident

`state.json` conserve les IDs Buffer, les créneaux, les compteurs R2 et le catalogue. Chaque envoi a un checkpoint durable avant l'appel, puis après le résultat. `queued` signifie accepté par Buffer, pas publié avec succès. Surveiller les erreurs de publication dans Buffer.

- `queued` : ne sera pas renvoyé.
- `rejected` : refus explicite, corriger puis relancer pour le prochain créneau.
- `sending` ou `uncertain` : les envois sont bloqués jusqu'à vérification humaine.

Pour débloquer une réponse incertaine, vérifier la file et l'historique Buffer. Si le post existe, mettre l'entrée à `queued` avec son `bufferId`. Si l'absence est confirmée, supprimer uniquement cette entrée de `deliveries`, commit et relancer. Ne pas effacer les suivis sans vérifier : cela pourrait créer des doublons. GitHub et Buffer ne partagent pas de transaction ; en cas d'ambiguïté, le script privilégie le blocage.

## Références

- [Buffer : organisations](https://developers.buffer.com/examples/get-organizations.html)
- [Buffer : chaînes](https://developers.buffer.com/examples/get-channels.html)
- [Buffer : programmation](https://developers.buffer.com/guides/posts-and-scheduling.html)
- [R2 : SDK S3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [R2 : jetons](https://developers.cloudflare.com/r2/api/tokens/)
- [GitHub : fuseaux et planifications](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Demande immédiate

Une modification de `.github/requests/publish-now.json` lance le workflow **Publier une vidéo maintenant**. Donner un nouvel `id` pour chaque demande autorisée. Ce workflow utilise `shareNow` sur les trois réseaux, conserve les protections et partage la même concurrence que le workflow planifié. Une relance avec le même ID ignore les destinations déjà acceptées. Une demande immédiate s'ajoute aux créneaux quotidiens de 23 h et 01 h.

Un refus explicite sur un réseau n'empêche pas l'envoi aux suivants. Une réponse incertaine bloque toujours les envois pour éviter les doublons. Les vidéos refusées comme non verticales pour YouTube Shorts sont ignorées pour cette destination aux prochaines relances, avec l'erreur conservée dans le suivi. Corriger le format et supprimer uniquement l'entrée rejetée pour réessayer YouTube.
