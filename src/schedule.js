const zone = 'Africa/Casablanca';
function parts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
}
export function nextPublications(now = new Date(), count = 2) {
  const targets = [];
  // Parcours des minutes UTC: suit les changements d'heure du Maroc sans offset fixe.
  const start = Math.ceil((now.getTime() + 10 * 60000) / 60000) * 60000;
  for (let i = 0; i < 26 * 60; i++) {
    const date = new Date(start + i * 60000), p = parts(date);
    if (p.minute === '00' && ['01', '23'].includes(p.hour)) {
      targets.push({ key: `${p.year}-${p.month}-${p.day}-${p.hour}h`, dueAt: date.toISOString() });
      if (targets.length === count) return targets;
    }
  }
  throw new Error('Aucun créneau trouvé');
}

export function nextPublication(now = new Date()) { return nextPublications(now, 1)[0]; }
