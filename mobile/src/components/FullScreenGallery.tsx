// Full-screen, swipeable image viewer. Opens on tapping a gallery photo,
// renders each image with contentFit="contain" (nothing cropped) on a near-
// black backdrop, pages horizontally, and closes via the ✕ or hardware back.
//
// Shared by the listing detail gallery and the shop page's price-list images.

import React, { useState, useEffect } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, Text, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Img } from './Img';
import { fullImageUrl } from '../api/upload';
import { fonts } from '../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export function FullScreenGallery({
  images, startIndex, onClose,
}: { images: { id: any; image_path: string }[]; startIndex: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(startIndex);
  const scrollRef = React.useRef<ScrollView>(null);

  // Jump to the tapped image on open. `contentOffset` covers iOS; the
  // deferred scrollTo covers Android, where the initial contentOffset on a
  // paging ScrollView is unreliable.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo({ x: startIndex * SCREEN_W, animated: false }), 0);
    return () => clearTimeout(t);
  }, [startIndex]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' }}>
        <ScrollView
          ref={scrollRef}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          contentOffset={{ x: startIndex * SCREEN_W, y: 0 }}
          onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
        >
          {images.map((im) => (
            <View key={im.id} style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center' }}>
              <Img source={{ uri: fullImageUrl(im.image_path) }} contentFit="contain" style={{ width: SCREEN_W, height: SCREEN_H }} />
            </View>
          ))}
        </ScrollView>

        {/* Close */}
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.85}
          style={{
            position: 'absolute', top: insets.top + 8, left: 14,
            width: 40, height: 40, borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 20, lineHeight: 22, fontWeight: '600' }}>✕</Text>
        </TouchableOpacity>

        {/* Image counter */}
        {images.length > 1 ? (
          <View style={{
            position: 'absolute', top: insets.top + 14, right: 16,
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}>
            <Text style={{ color: '#fff', fontFamily: fonts.ltr, fontSize: 13, fontWeight: '600' }}>
              {idx + 1} / {images.length}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
