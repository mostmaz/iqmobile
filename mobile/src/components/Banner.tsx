import React from 'react';
import { TouchableOpacity, Linking } from 'react-native';
import { Img } from './Img';
import { theme, radius, shadowSoft } from '../theme';
import { fullImageUrl } from '../api/upload';
import type { BannerRow } from '../api/endpoints';

// A dashboard-managed promotional banner. Tapping it opens the linked
// listing in-app (link_type='listing') or an external URL in the browser
// (link_type='external'). Wide image, cover-cropped to a fixed 5:2 ratio so
// banners line up regardless of the uploaded image's dimensions.
export function Banner({
  banner, onOpenListing,
}: {
  banner: BannerRow;
  onOpenListing: (id: number) => void;
}) {
  function onPress() {
    if (banner.link_type === 'listing') {
      const id = Number(banner.link_value);
      if (Number.isFinite(id) && id > 0) onOpenListing(id);
    } else {
      Linking.openURL(banner.link_value).catch(() => { /* dead link — ignore */ });
    }
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        borderRadius: radius.xxl, overflow: 'hidden', marginBottom: 12,
        backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line,
        ...shadowSoft,
      }}
    >
      <Img
        source={{ uri: fullImageUrl(banner.image_path) }}
        contentFit="cover"
        style={{ width: '100%', aspectRatio: 5 / 2 }}
      />
    </TouchableOpacity>
  );
}
