const zone = 'Africa/Casablanca';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function localParts(date) { return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value])); }

export function queueTargets(now = new Date(), count = 8) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Nombre de créneaux invalide');
  const targets = [];
  const start = Math.ceil((now.getTime() + 10 * 60000) / 60000) * 60000;

  // Une vidéo par heure, à l'heure pleine au Maroc.
  // Le parcours minute par minute respecte automatiquement les changements d'heure IANA.
  for (let i = 0; i < (count + 2) * 60; i++) {
    const date = new Date(start + i * 60000), p = localParts(date);
    if (p.minute === '00') {
      targets.push({ key: `${p.year}-${p.month}-${p.day}-${p.hour}h00`, dueAt: date.toISOString() });
      if (targets.length === count) return targets;
    }
  }
  throw new Error('Aucun créneau trouvé');
}

export function syncDue(state, now = Date.now()) {
  if (!state.queueSync?.lastAttemptAt) return true;
  const previous = Date.parse(state.queueSync.lastAttemptAt);
  if (!Number.isFinite(previous)) throw new Error('Date de synchronisation invalide');
  return now - previous >= 5 * 3600000;
}


export function platformQueueTargets(now = new Date(), platform = 'instagram', count = 8) {
  if (platform === 'instagram') return queueTargets(now, count);
  if (!['youtube', 'tiktok'].includes(platform)) return queueTargets(now, count);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Nombre de créneaux invalide');

  const targets = [];
  const nowParts = localParts(now);
  const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const startProbe = new Date(now.getTime() + 12 * 3600000);
  const allowedHours = new Set(['00', '06', '12', '18']);

  // YouTube/TikTok: 4 publications par jour, à partir de demain (heure Maroc).
  for (let i = 0; i < 4 * 24 * 60; i++) {
    const date = new Date(startProbe.getTime() + i * 60000);
    const p = localParts(date);
    const day = `${p.year}-${p.month}-${p.day}`;
    if (day === today || p.minute !== '00' || !allowedHours.has(p.hour)) continue;
    targets.push({ key: `${day}-${p.hour}h00`, dueAt: date.toISOString() });
    if (targets.length === count) return targets;
  }
  throw new Error('Aucun créneau plateforme trouvé');
}
