// Which contact buttons a shop's page and its listings show.
//
// Three inputs decide it, in order of force:
//   - shop_no_contact: the price book. Its rows carry OTHER shops' numbers
//     and its account answers nobody, so every channel is off.
//   - shop_origin='admin': a shop the operator created from the dashboard
//     or an import. Its owner never installed the app, so WhatsApp and chat
//     would ring a phone nobody is watching — only the call button stays,
//     because a call reaches the shop directly.
//   - shop_ch_*: the shop's own per-channel toggles. NULL counts as on.
//
// One function so the shop page, the listing card, the listing detail and
// the chat-creation gate can never disagree about which buttons exist.
export function channelsFor(u) {
  const noContact = !!u.shop_no_contact;
  const adminMade = u.shop_origin === 'admin';
  return {
    call: !noContact && (u.shop_ch_call ?? 1) ? true : false,
    whatsapp: !noContact && !adminMade && (u.shop_ch_whatsapp ?? 1) ? true : false,
    chat: !noContact && !adminMade && (u.shop_ch_chat ?? 1) ? true : false,
  };
}

// The columns channelsFor needs, for callers that build their own SELECT.
export const CHANNEL_COLS = 'shop_no_contact, shop_origin, shop_ch_call, shop_ch_whatsapp, shop_ch_chat';
