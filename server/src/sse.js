// In-process SSE hub. Per-user channel: Map<userId, Set<res>>
const channels = new Map();
const adminChannels = new Set();

export function addClient(userId, res) {
  if (!channels.has(userId)) channels.set(userId, new Set());
  channels.get(userId).add(res);
  // Clean up both the response AND the per-user Set when it goes empty,
  // otherwise the Map slowly accumulates one empty Set per ever-connected
  // user — a real leak on a long-running process.
  res.on('close', () => {
    const set = channels.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) channels.delete(userId);
  });
}

export function addAdminClient(res) {
  adminChannels.add(res);
  res.on('close', () => adminChannels.delete(res));
}

// Write a payload safely to one response — if the socket was closed
// between the close-handler firing and this call (race), `res.write`
// throws synchronously and would otherwise abort the for-loop in emitTo,
// silently dropping the event for every subsequent subscriber.
function safeWrite(res, payload) {
  try {
    if (!res.writableEnded) res.write(payload);
  } catch {}
}

// noop import guard so emitTo is referenceable from requests.js
export function emitTo(userId, event, data) {
  const set = channels.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) safeWrite(res, payload);
}

export function emitToAdmins(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of adminChannels) safeWrite(res, payload);
}

export function emitMany(userIds, event, data) {
  for (const id of userIds) emitTo(id, event, data);
}
