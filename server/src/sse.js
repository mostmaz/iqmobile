// In-process SSE hub. Per-user channel: Map<userId, Set<res>>
const channels = new Map();
const adminChannels = new Set();

export function addClient(userId, res) {
  if (!channels.has(userId)) channels.set(userId, new Set());
  channels.get(userId).add(res);
  res.on('close', () => {
    channels.get(userId)?.delete(res);
  });
}

export function addAdminClient(res) {
  adminChannels.add(res);
  res.on('close', () => adminChannels.delete(res));
}

// noop import guard so emitTo is referenceable from requests.js
export function emitTo(userId, event, data) {
  const set = channels.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

export function emitToAdmins(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of adminChannels) res.write(payload);
}

export function emitMany(userIds, event, data) {
  for (const id of userIds) emitTo(id, event, data);
}
