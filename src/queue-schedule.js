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
