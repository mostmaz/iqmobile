import { api } from './client';

// ─── Types ────────────────────────────────────────────────────────────
export type SellerType = 'individual' | 'shop';

export interface User {
  id: number;
  // Null when this is a guest account (server hides the synthetic
  // identifier). Becomes a real Iraqi mobile once the user upgrades.
  phone: string | null;
  display_name: string;
  governorate: string;
  city?: string | null;
  profile_image_path?: string | null;
  rating_avg: number;
  rating_count: number;
  verified: boolean;
  seller_type: SellerType;
  shop_years?: number | null;
  // Shop-specific fields, populated only when seller_type === 'shop' and
  // the user has completed the shop sub-flow.
  shop_image_path?: string | null;
  shop_lat?: number | null;
  shop_lng?: number | null;
  is_guest?: boolean;
  // First-login completion gate. Until this is true, the app forces the
  // user into the CompleteProfile screen.
  profile_completed?: boolean;
  // Remaining edits each tracked field has (cap is 2 lifetime edits each).
  // 0 means the field is locked.
  name_edits_remaining?: number;
  shop_image_edits_remaining?: number;
  shop_location_edits_remaining?: number;
}

export type Condition = 'new' | 'used' | 'repaired' | 'refurbished';
export type ListingStatus = 'active' | 'reserved' | 'sold' | 'expired' | 'removed';

export interface ListingImage {
  id: number;
  listing_id: number;
  image_path: string;
  position: number;
}

export interface Listing {
  id: number;
  seller_id: number;
  brand: string;
  model: string;
  storage?: string | null;
  color?: string | null;
  condition: Condition;
  battery_health?: number | null;
  warranty_status?: string | null;
  accessories: string[];
  asking_price: number;
  governorate: string;
  city?: string | null;
  description?: string | null;
  status: ListingStatus;
  created_at: number;
  expires_at: number;
  updated_at: number;
  images: ListingImage[];
  seller?: User | null;
  // Per-listing contact info (always public). `seller_phone` is a legacy
  // alias kept for older mobile builds — server returns `contact_phone`.
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  seller_phone?: string | null;
  phone_visible?: boolean;
}

export type DealStatus =
  | 'proposed' | 'buyer_accepted' | 'seller_confirmed'
  | 'rejected' | 'cancelled' | 'expired';

export interface Deal {
  id: number;
  chat_id: number;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  final_price: number;
  status: DealStatus;
  created_at: number;
  updated_at: number;
  seller_phone?: string | null;
  listing?: { id: number; brand: string; model: string; asking_price: number } | null;
  seller?: { id: number; display_name: string; profile_image_path?: string | null; phone?: string | null } | null;
  buyer?: { id: number; display_name: string; profile_image_path?: string | null } | null;
}

export interface Chat {
  id: number;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  created_at: number;
  last_message_at: number;
  role?: 'buyer' | 'seller';
  listing?: { id: number; brand: string; model: string; asking_price: number; status: ListingStatus; governorate: string; city?: string | null } | null;
  buyer?: User | null;
  seller?: (User & { phone?: string | null }) | null;
  active_deal?: Deal | null;
  phone_visible?: boolean;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name?: string;
  body?: string | null;
  image_path?: string | null;
  masked?: number;
  created_at: number;
}

export interface NotificationRow {
  id: number;
  kind: string;
  payload: any;
  read: boolean;
  created_at: number;
}

export interface RatingRow {
  id: number;
  stars: number;
  comment?: string | null;
  created_at: number;
  reviewer_id: number;
  reviewer_name: string;
  reviewer_image?: string | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────
export const Auth = {
  register: (body: any) => api<{ token: string; user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (phone: string, password: string) =>
    api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }),
  // Passwordless: server upserts the user by phone and returns a token.
  // If the caller currently has a guest token, the server promotes that
  // guest to a real account in-place so their session/listings carry over.
  phoneLogin: (phone: string) =>
    api<{ token: string; user: User }>('/auth/phone-login', { method: 'POST', body: JSON.stringify({ phone }) }),
  // Anonymous signup — server returns a token for an auto-created user.
  // Used during the "no auth" growth phase so we can populate the app.
  guest: (governorate?: string) =>
    api<{ token: string; user: User }>('/auth/guest', { method: 'POST', body: JSON.stringify({ governorate }) }),
  me: () => api<{ user: User }>('/auth/me'),
  patchMe: (body: any) => api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  // First-login completion lives in upload.ts (multipart). Imported as
  // a separate function from there since the JSON `api()` helper here
  // can't send FormData.
  pushToken: (expo_push_token: string) =>
    api('/auth/push-token', { method: 'POST', body: JSON.stringify({ expo_push_token }) }),
};

// ─── Listings ─────────────────────────────────────────────────────────
export interface BrowseFilters {
  q?: string;
  brand?: string;
  model?: string;
  governorate?: string;
  condition?: Condition;
  storage?: string;
  color?: string;
  min_price?: number;
  max_price?: number;
  verified_only?: boolean;
  seller_type?: SellerType;
  limit?: number;
  offset?: number;
}
function qs(params: BrowseFilters) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

export const Listings = {
  create: (body: any) => api<Listing>('/listings', { method: 'POST', body: JSON.stringify(body) }),
  browse: (f: BrowseFilters = {}) => api<Listing[]>('/listings' + qs(f)),
  mine: (status: 'all' | ListingStatus = 'all') => api<Listing[]>(`/listings/mine?status=${status}`),
  get: (id: number) => api<Listing>(`/listings/${id}`),
  patch: (id: number, body: any) => api<Listing>(`/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => api(`/listings/${id}`, { method: 'DELETE' }),
  renew: (id: number) => api<Listing>(`/listings/${id}/renew`, { method: 'POST' }),
  save: (id: number) => api(`/listings/${id}/save`, { method: 'POST' }),
  unsave: (id: number) => api(`/listings/${id}/save`, { method: 'DELETE' }),
  saved: () => api<Listing[]>('/listings/saved/mine'),
};

// ─── Chats ────────────────────────────────────────────────────────────
export const Chats = {
  startForListing: (listingId: number) => api<Chat>(`/listings/${listingId}/chat`, { method: 'POST' }),
  list: (role?: 'buyer' | 'seller') => api<Chat[]>(`/chats${role ? `?role=${role}` : ''}`),
  get: (id: number) => api<Chat>(`/chats/${id}`),
  messages: (id: number) => api<ChatMessage[]>(`/chats/${id}/messages`),
  sendText: (id: number, body: string) =>
    api<ChatMessage & { blocked?: boolean }>(`/chats/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  inboxSince: (since: number) => api<ChatMessage[]>(`/messages/inbox?since=${since}`),
  quickMessages: () => api<string[]>('/quick-messages'),
};

// ─── Deals ────────────────────────────────────────────────────────────
export const Deals = {
  proposePrice: (chatId: number, finalPrice: number) =>
    api<Deal>(`/chats/${chatId}/propose-price`, { method: 'POST', body: JSON.stringify({ final_price: finalPrice }) }),
  buyerAccept: (id: number) => api<Deal>(`/deals/${id}/buyer-accept`, { method: 'POST' }),
  buyerReject: (id: number) => api<Deal>(`/deals/${id}/buyer-reject`, { method: 'POST' }),
  counter: (id: number, finalPrice: number) =>
    api<Deal>(`/deals/${id}/counter-offer`, { method: 'POST', body: JSON.stringify({ final_price: finalPrice }) }),
  sellerConfirm: (id: number) => api<Deal>(`/deals/${id}/seller-confirm`, { method: 'POST' }),
  cancel: (id: number) => api<Deal>(`/deals/${id}/cancel`, { method: 'POST' }),
  mine: (role?: 'buyer' | 'seller', status: 'all' | DealStatus = 'all') => {
    const q = new URLSearchParams();
    if (role) q.set('role', role);
    if (status) q.set('status', status);
    return api<Deal[]>(`/deals/mine?${q.toString()}`);
  },
  rate: (dealId: number, stars: number, comment?: string) =>
    api(`/deals/${dealId}/rating`, { method: 'POST', body: JSON.stringify({ stars, comment }) }),
};

export const Users = {
  ratings: (id: number) => api<RatingRow[]>(`/users/${id}/ratings`),
};

export const Reports = {
  submit: (target_kind: 'listing' | 'user' | 'chat', target_id: number, reason: string, detail?: string) =>
    api('/reports', { method: 'POST', body: JSON.stringify({ target_kind, target_id, reason, detail }) }),
};

export const Notifications = {
  list: () => api<NotificationRow[]>('/notifications'),
  readAll: () => api('/notifications/read-all', { method: 'POST' }),
  read: (id: number) => api(`/notifications/${id}/read`, { method: 'POST' }),
};
