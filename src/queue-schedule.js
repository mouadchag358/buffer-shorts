const zone = 'Africa/Casablanca';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function localParts(date) { return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value])); }

// Quatre publications quotidiennes pour Facebook, Instagram et YouTube.
// Les nouvelles places commencent le lendemain, en heure du Maroc.
export function queueTargets(now = new Date(), count = 8) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Nombre de créneaux invalide');
  const targets = [];
  const nowParts = localParts(now);
  const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const startProbe = new Date(now.getTime() + 10 * 60000);
  const allowedHours = new Set(['00', '06', '12', '18']);
  for (let i = 0; i < 4 * 24 * 60; i++) {
    const date = new Date(startProbe.getTime() + i * 60000);
    const p = localParts(date);
    const day = `${p.year}-${p.month}-${p.day}`;
    if (day === today || p.minute !== '00' || !allowedHours.has(p.hour)) continue;
    targets.push({ key: `${day}-${p.hour}h00`, dueAt: date.toISOString() });
    if (targets.length === count) return targets;
  }
  throw new Error('Aucun créneau quotidien trouvé');
}

export function syncDue(state, now = Date.now()) {
  if (!state.queueSync?.lastAttemptAt) return true;
  const previous = Date.parse(state.queueSync.lastAttemptAt);
  if (!Number.isFinite(previous)) throw new Error('Date de synchronisation invalide');
  return now - previous >= 5 * 3600000;
}


export function platformQueueTargets(now = new Date(), platform = 'instagram', count = 8) {
  return queueTargets(now, count);
}
