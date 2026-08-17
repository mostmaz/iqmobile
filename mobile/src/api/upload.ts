import { getBaseUrl, getToken } from './client';
import type { ChatMessage, ListingImage, User } from './endpoints';

function mimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'bypass-tunnel-reminder': 'true' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function postForm<T>(url: string, fd: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: fd });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export function fullImageUrl(rel?: string | null): string {
  if (!rel) return '';
  if (rel.startsWith('http')) return rel;
  return `${getBaseUrl()}${rel}`;
}

// Optional listing video. The clip should already be compressed (see
// lib/videoCompress); this just ships it. The server answers pending —
// the wizard has already told the seller the clip waits for approval.
export async function uploadListingVideo(listingId: number, localUri: string): Promise<{ ok: boolean }> {
  const raw = localUri.split('/').pop() || 'video.mp4';
  const ext = (raw.split('.').pop() || '').toLowerCase();
  const ok = ['mp4', 'mov', 'm4v'].includes(ext);
  const filename = ok ? raw : 'video.mp4';
  const type = ext === 'mov' ? 'video/quicktime' : ext === 'm4v' ? 'video/x-m4v' : 'video/mp4';
  const fd = new FormData();
  fd.append('video', { uri: localUri, name: filename, type } as any);
  return postForm(`${getBaseUrl()}/listings/${listingId}/video`, fd);
}

export async function sendChatImage(chatId: number, localUri: string, body?: string): Promise<ChatMessage & { blocked?: boolean }> {
  const filename = localUri.split('/').pop() || 'image.jpg';
  const fd = new FormData();
  fd.append('image', { uri: localUri, name: filename, type: mimeFromExt(filename) } as any);
  if (body) fd.append('body', body);
  return postForm(`${getBaseUrl()}/chats/${chatId}/messages`, fd);
}

export async function uploadListingImages(listingId: number, localUris: string[]): Promise<ListingImage[]> {
  const fd = new FormData();
  for (const uri of localUris) {
    const filename = uri.split('/').pop() || 'photo.jpg';
    fd.append('images', { uri, name: filename, type: mimeFromExt(filename) } as any);
  }
  return postForm(`${getBaseUrl()}/listings/${listingId}/images`, fd);
}

// Shop price-list images (uploaded by the shop owner). Appends to the shop's
// gallery and returns the full ordered list back.
export async function uploadShopImages(localUris: string[]): Promise<{ ok: boolean; images: { id: number; image_path: string; position?: number }[] }> {
  const fd = new FormData();
  for (const uri of localUris) {
    const filename = uri.split('/').pop() || 'price.jpg';
    fd.append('images', { uri, name: filename, type: mimeFromExt(filename) } as any);
  }
  return postForm(`${getBaseUrl()}/shops/me/images`, fd);
}

export async function uploadProfileImage(localUri: string): Promise<{ profile_image_path: string }> {
  const filename = localUri.split('/').pop() || 'profile.jpg';
  const fd = new FormData();
  fd.append('image', { uri: localUri, name: filename, type: mimeFromExt(filename) } as any);
  return postForm(`${getBaseUrl()}/auth/profile-image`, fd);
}

// First-login profile completion. Multipart because shop users upload an
// image of the storefront sign. For individual users, shopImageUri/lat/lng
// are omitted entirely.
export async function completeProfile(args: {
  display_name: string;
  seller_type: 'individual' | 'shop';
  shopImageUri?: string;
  shop_lat?: number;
  shop_lng?: number;
}): Promise<{ user: User }> {
  const fd = new FormData();
  fd.append('display_name', args.display_name);
  fd.append('seller_type', args.seller_type);
  if (args.seller_type === 'shop') {
    if (args.shopImageUri) {
      const filename = args.shopImageUri.split('/').pop() || 'shop.jpg';
      fd.append('shop_image', { uri: args.shopImageUri, name: filename, type: mimeFromExt(filename) } as any);
    }
    if (args.shop_lat != null) fd.append('shop_lat', String(args.shop_lat));
    if (args.shop_lng != null) fd.append('shop_lng', String(args.shop_lng));
  }
  return postForm(`${getBaseUrl()}/auth/complete-profile`, fd);
}

export async function updateShopImage(localUri: string): Promise<{ user: User }> {
  const filename = localUri.split('/').pop() || 'shop.jpg';
  const fd = new FormData();
  fd.append('shop_image', { uri: localUri, name: filename, type: mimeFromExt(filename) } as any);
  return postForm(`${getBaseUrl()}/auth/shop-image`, fd);
}
