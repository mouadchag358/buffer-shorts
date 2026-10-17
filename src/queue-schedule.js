const zone = 'Africa/Casablanca';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function localParts(date) {
  return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
}

const dayKey = p => `${p.year}-${p.month}-${p.day}`;
const timeKey = p => `${p.hour}:${p.minute}`;

// Facebook/Instagram: 12 créneaux par jour, un par fenêtre de deux heures.
// YouTube/TikTok restent à quatre créneaux/jour.
// Chaque minute est pseudo-aléatoire, par pas de cinq minutes, et stable par date/réseau.
export const dailyVideoCount = platform => ['facebook', 'instagram'].includes(platform) ? 12 : 4;
const fourWindowStarts = [1, 7, 13, 19];
const twelveWindowStarts = Array.from({ length: 12 }, (_, i) => i * 2);

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

// Le même jour et le même réseau donnent les mêmes horaires à chaque sync.
// Sans ce déterminisme, toutes les vidéos déjà planifiées changeraient sans cesse.
function dailyTimes(day, platform) {
  const twelve = dailyVideoCount(platform) === 12;
  const starts = twelve ? twelveWindowStarts : fourWindowStarts;
  const slotsPerWindow = twelve ? 24 : 48;
  return starts.map((hourStart, index) => {
    const offset = stableHash(`buffer-shorts:${platform}:${day}:${index}`) % slotsPerWindow;
    const hour = hourStart + Math.floor(offset / 12);
    const minute = (offset % 12) * 5;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });
}

export function isPlannedVideoSlot(date, platform = 'instagram') {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime()) || value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0) return false;
  const p = localParts(value);
  return dailyTimes(dayKey(p), platform).includes(timeKey(p));
}

// Douze vidéos/jour Facebook et Instagram, quatre/jour YouTube.
// Inclure les créneaux encore libres aujourd'hui pour assurer les 12 publications.
// Toujours éviter les créneaux proches de moins de dix minutes.
export function platformQueueTargets(now = new Date(), platform = 'instagram', count = 8) {
  if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Nombre de créneaux invalide');
  if (!Number.isFinite(new Date(now).getTime())) throw new Error('Date de référence invalide');
  const start = Math.ceil((now.getTime() + 10 * 60000) / 300000) * 300000;
  const targets = [];
  const dailyCache = new Map();

  for (let i = 0; i < (Math.ceil(count / dailyVideoCount(platform)) + 5) * 24 * 12; i++) {
    const date = new Date(start + i * 300000);
    const p = localParts(date);
    const day = dayKey(p);
    if (!dailyCache.has(day)) dailyCache.set(day, new Set(dailyTimes(day, platform)));
    if (!dailyCache.get(day).has(timeKey(p))) continue;
    targets.push({ key: `${day}-${p.hour}h${p.minute}`, dueAt: date.toISOString() });
    if (targets.length === count) return targets;
  }
  throw new Error('Aucun créneau quotidien trouvé');
}
export function queueTargets(now = new Date(), count = 8) {
  return platformQueueTargets(now, 'instagram', count);
}

// Occupation réservée par heure locale (inclut les vidéos externes à Buffer).
export function videoHourKey(date) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error('Video schedule date invalid');
  const p = localParts(value);
  return `${p.year}-${p.month}-${p.day}-${p.hour}`;
}
export function syncDue(state, now = Date.now()) {
  if (!state.queueSync?.lastAttemptAt) return true;
  const previous = Date.parse(state.queueSync.lastAttemptAt);
  if (!Number.isFinite(previous)) throw new Error('Date de synchronisation invalide');
  return now - previous >= 5 * 3600000;
}
