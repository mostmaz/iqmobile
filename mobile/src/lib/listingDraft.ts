// The posting wizard's draft, kept on the device.
//
// Before this, every field lived in `useState` on a screen that is the Sell
// TAB ROOT — and navigation/index.tsx deliberately remounts that screen on
// every Sell tab tap (`resetToRootOnTabPress(..., { always: true })`, added
// to defeat component reuse so a cancelled wizard doesn't leak into the next
// one). So the form was destroyed by switching to Browse and back, silently,
// on top of the obvious loss when the OS kills the app. A seller who
// compressed ten photos at step 5 could lose all of it to a mis-tap.
//
// The draft is device-local on purpose. `phone_listings.is_draft` exists and
// is correctly excluded from every public query, but it is written only by
// the shop web panel — and a half-finished listing has no business reaching
// the server at all. Nothing here talks to the API.
//
// PHOTO DURABILITY is the part that isn't obvious. compressForListing()
// writes through expo-image-manipulator, which lands in the app's CACHE
// directory; iOS and Android are both free to purge that between launches.
// Persisting the URIs alone would give you a draft that restores with broken
// images. So accepted photos are copied into documentDirectory/listing-draft/
// and the copies are what we remember — then re-checked on the way back in,
// because "durable" is not "guaranteed".

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { newClientKey, type ListingDraft, type RestoredDraft } from './listingDraftCore';

// Re-exported so callers keep a single import site; the split is only about
// keeping the pure rules testable under bare node.
export {
  newClientKey, draftIsSubstantial, setWizardDirty, isWizardDirty,
} from './listingDraftCore';
export type { ListingDraft, RestoredDraft } from './listingDraftCore';

// `iq_` + a version suffix, matching iq_cart_v1 / iq_compare_v2. Bumping the
// suffix is how a shape change discards old drafts instead of half-reading
// them.
const KEY = 'iq_listing_draft_v1';

const DRAFT_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}listing-draft/`
  : null;

async function ensureDir(): Promise<boolean> {
  if (!DRAFT_DIR) return false;
  try {
    const info = await FileSystem.getInfoAsync(DRAFT_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(DRAFT_DIR, { intermediates: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a freshly-compressed photo out of the cache and into the draft folder.
 * Returns the durable URI, or the original if the copy failed — a failed copy
 * must never cost the user the photo they just picked; it only means that one
 * photo may not survive a cold start.
 */
export async function persistDraftImage(uri: string): Promise<string> {
  if (!uri.startsWith('file://') || !(await ensureDir())) return uri;
  // Already ours (a restored draft being re-saved) — copying again would
  // orphan a file on every keystroke.
  if (DRAFT_DIR && uri.startsWith(DRAFT_DIR)) return uri;
  try {
    const ext = (uri.split('.').pop() || 'jpg').split('?')[0].slice(0, 5);
    const to = `${DRAFT_DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await FileSystem.copyAsync({ from: uri, to });
    return to;
  } catch {
    return uri;
  }
}

export async function saveDraft(draft: Omit<ListingDraft, 'savedAt'>): Promise<void> {
  try {
    const payload: ListingDraft = { ...draft, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // A draft that can't be written is a silent degradation, not an error the
    // seller can act on. Losing the save is strictly better than an alert
    // interrupting them mid-form.
  }
}

/**
 * Read the draft back, dropping any photo whose file has since been purged.
 * Returns null when there is nothing worth restoring.
 */
export async function loadDraft(): Promise<RestoredDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as ListingDraft;
    if (!d || typeof d !== 'object') return null;

    const images = Array.isArray(d.images) ? d.images.filter((u) => typeof u === 'string') : [];
    const alive: string[] = [];
    for (const uri of images) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && (info as any).size !== 0) alive.push(uri);
      } catch {
        // Unreadable counts as gone; a URI we can't stat can't be uploaded.
      }
    }

    const draft: ListingDraft = {
      ...d,
      images: alive,
      accessories: Array.isArray(d.accessories) ? d.accessories : [],
      clientKey: typeof d.clientKey === 'string' && d.clientKey ? d.clientKey : newClientKey(),
    };
    return { draft, lostImages: images.length - alive.length };
  } catch {
    return null;
  }
}

/**
 * Forget the draft and delete its photos. Called on a successful publish and
 * on an explicit discard — never on a failure, which is exactly when the
 * seller needs the draft most.
 */
export async function clearDraft(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
  if (!DRAFT_DIR) return;
  try { await FileSystem.deleteAsync(DRAFT_DIR, { idempotent: true }); } catch {}
}
