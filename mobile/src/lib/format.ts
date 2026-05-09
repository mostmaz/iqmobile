export function formatIQD(n: number) {
  return n.toLocaleString('en-US') + ' د.ع';
}

export function timeLeftMs(expiresAt: number) {
  return Math.max(0, expiresAt - Date.now());
}

export function formatCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}س ${m % 60}د`;
  return `${m}د ${s % 60}ث`;
}
