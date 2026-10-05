const zone = 'Africa/Casablanca';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function localParts(date) { return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value])); }
export function queueTargets(now = new Date(), count = 4) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Nombre de créneaux invalide');
  const targets = [], start = Math.ceil((now.getTime() + 10 * 60000) / 60000) * 60000;
  for (let i = 0; i < (count + 1) * 24 * 60; i++) {
    const date = new Date(start + i * 60000), p = localParts(date);
    if (['23:00', '00:20', '01:40', '03:00'].includes(p.hour + ':' + p.minute)) {
      targets.push({ key: `${p.year}-${p.month}-${p.day}-${p.hour}h${p.minute}`, dueAt: date.toISOString() });
      if (targets.length === count) return targets;
    }
  }
  throw new Error('Aucun créneau trouvé');
}
export function syncDue(state, now = Date.now()) {
  if (!state.queueSync?.lastAttemptAt) return true;
  const previous = Date.parse(state.queueSync.lastAttemptAt);
  if (!Number.isFinite(previous)) throw new Error('Date de synchronisation invalide');
  return now - previous >= 12 * 3600000;
}
