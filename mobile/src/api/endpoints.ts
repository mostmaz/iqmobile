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
  shop_name?: string | null;
  shop_bio?: string | null;
  shop_address?: string | null;
  shop_phone?: string | null;
  shop_whatsapp?: string | null;
  shop_phones?: string[];
  shop_facebook?: string | null;
  shop_instagram?: string | null;
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
  // Featured-listing revenue fields. `is_featured` is the server-computed
  // (clock-safe) flag the card badges off; the rest describe the window.
  is_featured?: boolean;
  featured_until?: number | null;
  feature_tier?: string | null;
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
  // Server-enriched summaries (see server/src/routes/notifications.js):
  // chat_summary is populated for any notif whose payload carries a
  // chat_id (chat.message + deal.* mostly). listing_summary is the
  // fallback for kinds that ship a bare listing_id (listing.expired,
  // rating.received, …). Either field can be null on rows where the
  // related row was deleted between create + read.
  chat_summary?: {
    chat_id: number;
    other_name: string | null;
    listing_label: string | null;
  } | null;
  listing_summary?: {
    brand: string;
    model: string;
  } | null;
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
  // Passwordless phone entry. Two possible responses:
  //   - { token, user } → OTP disabled server-side, sign-in complete.
  //   - { otp_required: true, channel } → server queued a Twilio Verify
  //     code and expects the client to collect it and POST /auth/otp/verify.
  // Optional `channel` lets the client force WhatsApp; defaults to SMS.
  phoneLogin: (phone: string, channel?: 'sms' | 'whatsapp') =>
    api<{ token?: string; user?: User; otp_required?: boolean; channel?: 'sms' | 'whatsapp' }>(
      '/auth/phone-login',
      { method: 'POST', body: JSON.stringify({ phone, channel }) },
    ),
  otpVerify: (phone: string, code: string) =>
    api<{ token: string; user: User }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  // Anonymous signup — server returns a token for an auto-created user.
  // Used during the "no auth" growth phase so we can populate the app.
  guest: (governorate?: string) =>
    api<{ token: string; user: User }>('/auth/guest', { method: 'POST', body: JSON.stringify({ governorate }) }),
  me: () => api<{ user: User }>('/auth/me'),
  patchMe: (body: any) => api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  // Permanent account deletion. Server cascade-removes the user row
  // and all dependent data (listings, saves, ratings, chats, files).
  // Caller must clear the local token + reset analytics identity
  // right after this resolves.
  deleteMe: () => api('/auth/me', { method: 'DELETE' }),
  // First-login completion lives in upload.ts (multipart). Imported as
  // a separate function from there since the JSON `api()` helper here
  // can't send FormData.
  pushToken: (expo_push_token: string) =>
    api('/auth/push-token', { method: 'POST', body: JSON.stringify({ expo_push_token }) }),
  // Temporary diagnostic endpoint. Used by registerPushToken to log each
  // step of the token-registration flow server-side so we can see what
  // fails on devices we can't debug-attach. Safe to swallow errors —
  // it's logging, not control flow.
  pushDebug: (msg: string) =>
    api('/auth/push-debug', { method: 'POST', body: JSON.stringify({ msg }) }).catch(() => {}),
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
  // Rotation seed for the capped featured slots (top 2 per view). Bumped on
  // refresh/filter/focus so which featured listings hold the slots rotates,
  // while staying stable across pages of one pagination session.
  seed?: number;
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
  // Report a call/WhatsApp tap. This is what fills the dashboard's contact
  // columns — a tap deep-links out of the app, so the POST is the only signal
  // the server can ever get. Fire-and-forget: never block opening the dialler.
  contact: (id: number, channel: 'call' | 'whatsapp') =>
    api(`/listings/${id}/contact`, { method: 'POST', body: JSON.stringify({ channel }) })
      .catch(() => { /* best-effort analytics */ }),
};

// ─── Saved searches ───────────────────────────────────────────────────
// A user stores browse/search criteria and (when alerts_enabled) gets a
// push the moment a new listing matches. The server validates + normalizes
// the criteria, so we can send whatever subset of these the user narrowed to.
export interface SavedSearchCriteria {
  q?: string;
  brand?: string;
  model?: string;
  governorate?: string;
  condition?: Condition;
  min_price?: number;
  max_price?: number;
}
export interface SavedSearch {
  id: number;
  label: string | null;
  criteria: SavedSearchCriteria;
  alerts_enabled: boolean;
  created_at: number;
}
export const SavedSearches = {
  list: () => api<SavedSearch[]>('/saved-searches'),
  create: (criteria: SavedSearchCriteria, label?: string) =>
    api<SavedSearch>('/saved-searches', { method: 'POST', body: JSON.stringify({ criteria, label }) }),
  setAlerts: (id: number, alerts_enabled: boolean) =>
    api<SavedSearch>(`/saved-searches/${id}`, { method: 'PATCH', body: JSON.stringify({ alerts_enabled }) }),
  remove: (id: number) => api(`/saved-searches/${id}`, { method: 'DELETE' }),
};

// ─── Price watches ──────────────────────────────────────────────────────
// "Tell me if THIS listing gets cheaper." Watch state for the current user
// arrives as is_price_watched on the listing detail response.
export const PriceWatches = {
  watch: (listingId: number) => api(`/listings/${listingId}/price-watch`, { method: 'POST' }),
  unwatch: (listingId: number) => api(`/listings/${listingId}/price-watch`, { method: 'DELETE' }),
};

// ─── Wish list ──────────────────────────────────────────────────────────
// "I want THIS device at THIS price or less." One entry per wanted device
// (exact catalog model) + price ceiling; the server alerts when a matching
// listing appears — newly posted or price-dropped through the ceiling.
export interface WishItem {
  id: number;
  brand: string;
  model: string;
  max_price: number;
  created_at: number;
}
export const Wishlist = {
  list: () => api<WishItem[]>('/wishlist'),
  add: (brand: string, model: string, max_price: number) =>
    api<WishItem>('/wishlist', { method: 'POST', body: JSON.stringify({ brand, model, max_price }) }),
  setMaxPrice: (id: number, max_price: number) =>
    api<WishItem>(`/wishlist/${id}`, { method: 'PATCH', body: JSON.stringify({ max_price }) }),
  remove: (id: number) => api(`/wishlist/${id}`, { method: 'DELETE' }),
};

// ─── Device catalog (brand → model) ─────────────────────────────────────
// Powers the post-listing model dropdown and the filter-based search, so a
// seller and a buyer pick the SAME device name. Devices come per brand and
// are searchable server-side (a brand can have 500+ models).
export type DeviceType = 'phone' | 'tablet' | 'watch';
export interface CatalogBrand { brand: string; count: number }
export interface CatalogDevice { id: number; model: string }
export const DeviceCatalog = {
  brands: (type: DeviceType = 'phone') =>
    api<CatalogBrand[]>(`/device-catalog/brands?type=${type}`),
  devices: (brand: string, q = '', type: DeviceType = 'phone') =>
    api<CatalogDevice[]>(`/device-catalog/devices?brand=${encodeURIComponent(brand)}&type=${type}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  // "My device isn't listed" — queue it for admin review. Never blocks the
  // listing; the free-typed model is already saved on the listing itself.
  suggest: (brand: string, model: string, opts?: { device_type?: DeviceType; listing_id?: number }) =>
    api<{ ok: boolean; already_in_catalog?: boolean; duplicate?: boolean; id?: number }>(
      '/device-suggestions',
      { method: 'POST', body: JSON.stringify({ brand, model, device_type: opts?.device_type || 'phone', listing_id: opts?.listing_id }) },
    ),
};

// ─── Chats ────────────────────────────────────────────────────────────
export const Chats = {
  startForListing: (listingId: number) => api<Chat>(`/listings/${listingId}/chat`, { method: 'POST' }),
  list: (role?: 'buyer' | 'seller') => api<Chat[]>(`/chats${role ? `?role=${role}` : ''}`),
  // Sellers viewing "incoming buyer chats for THIS listing" from their
  // own ListingDetail. Backed by the same GET /chats endpoint with a
  // `listing_id` filter — see server/src/routes/chats.js.
  listForListing: (listingId: number) => api<Chat[]>(`/chats?listing_id=${listingId}`),
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

// ─── Brands ──────────────────────────────────────────────────────────
// Brand catalog is server-side now (was hardcoded). BrowseScreen reads
// from here on focus, cached 5 min via React Query.
export interface BrandRow {
  id: number;
  name: string;
  display_ar: string | null;
  position: number;
  count: number;
}
export const Brands = {
  list: () => api<BrandRow[]>('/brands'),
};

// ─── Banners ─────────────────────────────────────────────────────────
// Dashboard-managed promo banners (enabled-only from the server). `home`
// banners are injected into the feed; `brand` banners show on brand-filtered
// views — the server returns the specific-brand ones first, then any
// "every brand" banners (brand === null).
export interface BannerRow {
  id: number;
  placement: 'home' | 'brand';
  brand: string | null;
  governorate: string | null;
  image_path: string;
  link_type: 'listing' | 'external';
  link_value: string;
  position: number;
}
export const Banners = {
  home: (gov?: string) =>
    api<BannerRow[]>(`/banners?placement=home${gov ? `&gov=${encodeURIComponent(gov)}` : ''}`),
  brand: (brand?: string, gov?: string) =>
    api<BannerRow[]>(
      `/banners?placement=brand` +
      `${brand ? `&brand=${encodeURIComponent(brand)}` : ''}` +
      `${gov ? `&gov=${encodeURIComponent(gov)}` : ''}`,
    ),
};

export const Notifications = {
  list: () => api<NotificationRow[]>('/notifications'),
  readAll: () => api('/notifications/read-all', { method: 'POST' }),
  read: (id: number) => api(`/notifications/${id}/read`, { method: 'POST' }),
};

// ─── Featured listings ───────────────────────────────────────────────
// No payment gateway: the seller transfers airtime to the owner's number,
// submits a request with the carrier + sending number, and an admin approves
// it from the dashboard (which pins the listing).
export type FeatureCarrier = 'asiacell' | 'korek';
export interface FeatureTier {
  key: string;          // 'bronze' | 'silver' | 'gold'
  amount: number;       // IQD
  days: number;
  boosts_per_day: number;
  label_ar: string;
}
export interface FeatureTiersResponse {
  tiers: FeatureTier[];
  carriers: FeatureCarrier[];
  owner_phone: string;  // primary contact (Asiacell)
  // Per-carrier receiving numbers + USSD dial templates. The app fills
  // {amount} (tier IQD) and {number} (the matching receiving number) and
  // opens the dialer with the result.
  transfer_numbers: Record<FeatureCarrier, string>;
  ussd_templates: Record<FeatureCarrier, string>;
}
export interface FeatureRequest {
  id: number;
  listing_id: number;
  tier: string;
  amount: number;
  days: number;
  boosts_per_day: number;
  carrier: string;
  sender_phone: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  reviewed_at: number | null;
  brand?: string;
  model?: string;
  featured_until?: number | null;
}
export const Features = {
  tiers: () => api<FeatureTiersResponse>('/features/tiers'),
  request: (listingId: number, body: { tier: string; carrier: FeatureCarrier; sender_phone: string; note?: string }) =>
    api<FeatureRequest>(`/listings/${listingId}/feature-request`, { method: 'POST', body: JSON.stringify(body) }),
  // Cancels the caller's pending request for this listing — the "لم أحوّل
  // الرصيد بعد" escape hatch when the dial was never completed.
  cancelRequest: (listingId: number) =>
    api(`/listings/${listingId}/feature-request`, { method: 'DELETE' }),
  mine: () => api<FeatureRequest[]>('/features/mine'),
};

// ─── Shops ───────────────────────────────────────────────────────────
export interface ShopCard {
  id: number;
  display_name: string;
  shop_name: string;
  governorate: string;
  city?: string | null;
  profile_image_path?: string | null;
  shop_image_path?: string | null;
  shop_bio?: string | null;
  shop_address?: string | null;
  shop_phone?: string | null;
  shop_whatsapp?: string | null;
  shop_phones?: string[];
  shop_facebook?: string | null;
  shop_instagram?: string | null;
  rating_avg: number;
  rating_count: number;
  verified: boolean;
  is_featured: boolean;
  listing_count: number;
  // Storefront mode — add-to-cart + COD checkout instead of call/WhatsApp.
  orders_enabled?: boolean;
  shipping_fee?: number | null;
}
export interface ShopImage { id: number; image_path: string; position?: number }
export interface ShopDetail extends ShopCard {
  listings: Listing[];
  shop_images?: ShopImage[];
}
export const Shops = {
  list: (governorate?: string) =>
    api<ShopCard[]>('/shops' + (governorate ? `?governorate=${encodeURIComponent(governorate)}` : '')),
  get: (id: number) => api<ShopDetail>(`/shops/${id}`),
  register: (body: {
    shop_name: string; shop_bio?: string; shop_phone?: string;
    shop_whatsapp?: string; shop_address?: string; governorate?: string;
    shop_phones?: string[]; shop_facebook?: string | null; shop_instagram?: string | null;
  }) => api<ShopCard & { shop_images?: ShopImage[] }>('/shops/register', { method: 'POST', body: JSON.stringify(body) }),
  removeImage: (imageId: number) =>
    api<{ ok: boolean; images: ShopImage[] }>(`/shops/me/images/${imageId}`, { method: 'DELETE' }),
};

// ─── COD orders ───────────────────────────────────────────────────────
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export interface OrderItem {
  id: number; listing_id: number | null; brand: string; model: string;
  storage: string | null; color: string | null; image_path: string | null;
  unit_price: number; qty: number; line_total: number;
}
export interface Order {
  id: number; code: string; shop_id: number; shop_name: string | null;
  customer_name: string; customer_phone: string; governorate: string;
  address: string; note: string | null;
  subtotal: number; shipping_fee: number; total: number;
  payment_method: 'cod'; status: OrderStatus; cancel_reason: string | null;
  created_at: number; updated_at: number;
  items: OrderItem[];
}
export const Orders = {
  // The server prices the order; we only ever send listing ids + quantities.
  create: (body: {
    items: Array<{ listing_id: number; qty: number }>;
    customer_name: string; customer_phone: string;
    governorate: string; address: string; note?: string;
  }) => api<Order>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  mine: () => api<Order[]>('/orders/mine'),
  get: (id: number) => api<Order>(`/orders/${id}`),
  cancel: (id: number) => api<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
};

// ─── Storefront (shop browsed as a shop, not as a listings feed) ──────
//
// The marketplace's unit is a listing — one device, one price. A storefront's
// unit is a PRODUCT with options ("Realme C100i" in 64/128/256GB). The server
// derives products by grouping the shop's listings on brand + model, so each
// variant here IS a listing and checkout is unchanged.
export interface StoreShop {
  id: number; name: string; phone: string | null; shipping_fee: number;
}
export interface StoreCategory { brand: string; count: number }
export type StoreType = 'phone' | 'tablet' | 'accessory';
export interface StoreTypeCount { type: StoreType; count: number }
export interface StoreHome {
  shop: StoreShop;
  categories: StoreCategory[];
  // Product kinds actually in stock. Brands alone can't answer "show me
  // tablets" — one brand spans a phone, a tablet and five pairs of earbuds.
  types: StoreTypeCount[];
  product_count: number;
  min_price: number | null;
  max_price: number | null;
}
export interface StoreProductCard {
  key: string;
  brand: string;
  model: string;
  variant_count: number;
  min_price: number;
  max_price: number;
  image_path: string | null;
  lead_id: number;
}
export interface StoreProductPage {
  total: number; limit: number; offset: number; products: StoreProductCard[];
}
export interface StoreVariant {
  id: number; brand: string; model: string;
  storage: string | null; color: string | null; condition: string;
  asking_price: number; description: string | null;
  images: Array<{ id: number; image_path: string; position: number }>;
}
export interface StoreProduct {
  brand: string; model: string; description: string | null;
  images: Array<{ id: number; image_path: string; position: number }>;
  min_price: number; max_price: number;
  storages: string[]; colors: string[];
  variants: StoreVariant[];
  shop: StoreShop;
}
export type StoreSort = 'newest' | 'price_asc' | 'price_desc';
export const Storefront = {
  home: (shopId: number) => api<StoreHome>(`/storefront/${shopId}`),
  products: (shopId: number, opts: {
    q?: string; brand?: string; type?: StoreType; sort?: StoreSort;
    min_price?: number; max_price?: number; limit?: number; offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api<StoreProductPage>(`/storefront/${shopId}/products${s ? `?${s}` : ''}`);
  },
  product: (shopId: number, brand: string, model: string) =>
    api<StoreProduct>(
      `/storefront/${shopId}/product?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`,
    ),
};
