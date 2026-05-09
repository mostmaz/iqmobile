// In-app chat is hidden for now, so the chat-message banner is a no-op.
// We keep the component (and the export site) so the navigation tree
// doesn't change shape — when chat returns, restore from git history.

import React from 'react';

export function NotificationBanner() {
  return null;
}
