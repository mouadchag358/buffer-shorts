// Budget global aux URL vidéo, conservé dans state.json entre les workflows.
const MAX_PER_DAY = 4;
const MAX_PER_RUN = 1;
const MIN_INTERVAL_MS = 10_000;
export function mediaChecker({ state, persist, fetcher = fetch, now = () => Date.now(), maxPerRun = MAX_PER_RUN }) {
  if (![1, 2].includes(maxPerRun)) throw new Error('Budget média invalide');
  let calls = 0;
  return async function checkMedia(url) {
    const timestamp = now();
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const prior = state.mediaRequests;
    if (prior && (typeof prior.day !== 'string' || !Number.isSafeInteger(prior.count) || prior.count < 0 || !Number.isFinite(prior.lastAt) || !Number.isFinite(prior.pauseUntil))) throw new Error('Compteur média invalide: vérification manuelle nécessaire');
    if (prior?.pauseUntil > timestamp) throw new Error('Vérifications R2 en pause après une réponse 429');
    if (prior && timestamp - prior.lastAt < MIN_INTERVAL_MS) throw new Error('Vérifications R2 trop rapprochées');
    const count = prior?.day === day ? prior.count : 0;
    if (calls >= maxPerRun || count >= MAX_PER_DAY) throw new Error(`Limite R2 atteinte: ${maxPerRun} vérification(s) par exécution, 4 par jour UTC`);
    // Sauvegarde AVANT toute requête, même si celle-ci échoue ou est interrompue.
    state.mediaRequests = { day, count: count + 1, lastAt: timestamp, pauseUntil: prior?.pauseUntil || 0 };
    calls += 1;
    await persist(state);
    // Aucune relance ni redirection automatique: un seul appel réseau.
    const response = await fetcher(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
      const parsedDate = Date.parse(retryAfter || '');
      const requested = Number.isFinite(seconds) ? timestamp + seconds * 1000 : parsedDate;
      state.mediaRequests.pauseUntil = Math.max(timestamp + 3600000, Number.isFinite(requested) ? requested : 0);
      await persist(state);
      throw new Error('R2 HTTP 429: arrêt et pause d’au moins une heure');
    }
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('video/')) throw new Error('URL vidéo inaccessible ou Content-Type différent de video/*');
  };
}
