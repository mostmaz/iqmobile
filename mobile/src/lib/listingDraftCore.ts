// The parts of draft recovery that are pure decisions, kept free of any
// native import so they can be unit-tested under bare node.
//
// listingDraft.ts does the AsyncStorage + filesystem work and re-exports
// everything here, so callers still import from one place. The split exists
// because `expo-file-system/legacy` only resolves through Metro — importing
// it at module scope made the whole module untestable, and these two rules
// are precisely the ones that were wrong before.

/** Everything the wizard needs to come back exactly as it was left. */
export interface ListingDraft {
  step: number;
  brand: string;
  model: string;
  condition: string;
  storage: string;
  color: string;
  batteryHealth: string;
  warranty: string;
  accessories: string[];
  askingPrice: string;
  govAr: string;
  city: string;
  description: string;
  images: string[];
  contactPhone: string;
  contactWhatsapp: string;
  waSameAsPhone: boolean;
  /** Idempotency token for POST /listings — see the server's client_key. */
  clientKey: string;
  savedAt: number;
}

export interface RestoredDraft {
  draft: ListingDraft;
  /** Photos whose files no longer exist. The restore still happens; we say so. */
  lostImages: number;
}

/**
 * A token that survives the draft, so a create whose RESPONSE was lost can be
 * retried without making a second listing. It must NOT be regenerated per
 * attempt — that would defeat the whole point.
 */
export function newClientKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Synchronous mirror of "the wizard currently holds unsaved work".
//
// navigation/index.tsx resets the Sell stack from a tabPress handler, which
// cannot await AsyncStorage — so the screen publishes its dirty state here
// and the handler reads it inline. In-memory only: it is a UI decision for
// this process, not state worth persisting.
let _wizardDirty = false;
export function setWizardDirty(v: boolean) { _wizardDirty = v; }
export function isWizardDirty(): boolean { return _wizardDirty; }

/**
 * Is there anything in this draft worth offering to restore?
 *
 * Deliberately ignores condition/storage/warranty/governorate: those start
 * pre-filled, and counting them would offer a restore to every seller who
 * merely opened the tab. `brand` DOES count — the wizard's old isDirty
 * omitted it, so a brand-only form reported itself clean and was discarded.
 */
export function draftIsSubstantial(d: ListingDraft | null | undefined): boolean {
  if (!d) return false;
  return !!(
    d.brand || d.model || d.color || d.batteryHealth || d.askingPrice ||
    d.city || d.description || d.contactPhone || d.contactWhatsapp ||
    (d.accessories && d.accessories.length > 0) ||
    (d.images && d.images.length > 0)
  );
}
