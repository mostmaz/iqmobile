// Shared "save this search" action used by the Browse filter sheet and the
// Search tab. Handles auth gating (guests bounce to AuthGate), the create
// call, and a confirmation that offers to open the saved-searches list.
import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { SavedSearches, type SavedSearchCriteria } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';

// Keys the server actually stores — drop empties so an all-blank criteria
// (which the server rejects as empty_criteria) never gets sent.
function clean(c: SavedSearchCriteria): SavedSearchCriteria {
  const out: SavedSearchCriteria = {};
  if (c.q && c.q.trim()) out.q = c.q.trim();
  if (c.brand) out.brand = c.brand;
  if (c.model && c.model.trim()) out.model = c.model.trim();
  if (c.governorate) out.governorate = c.governorate;
  if (c.condition) out.condition = c.condition;
  if (c.min_price != null) out.min_price = c.min_price;
  if (c.max_price != null) out.max_price = c.max_price;
  return out;
}
export function hasCriteria(c: SavedSearchCriteria): boolean {
  return Object.keys(clean(c)).length > 0;
}

export function useSaveSearch() {
  const { user } = useAuth();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const [isPending, setPending] = useState(false);

  async function save(criteria: SavedSearchCriteria) {
    if (!user || (user as any).is_guest) {
      nav.getParent()?.getParent?.()?.navigate('AuthGate') ?? nav.navigate('AuthGate');
      return;
    }
    const c = clean(criteria);
    if (Object.keys(c).length === 0) {
      Alert.alert('لا يوجد بحث لحفظه', 'اختر ماركة أو سعراً أو اكتب كلمة بحث أولاً.');
      return;
    }
    setPending(true);
    try {
      await SavedSearches.create(c);
      qc.invalidateQueries({ queryKey: ['saved-searches'] });
      Alert.alert('تم حفظ البحث ✅', 'سنرسل لك تنبيهاً عند إضافة إعلان مطابق.', [
        { text: 'تمام', style: 'cancel' },
        { text: 'عرض عمليات البحث', onPress: () => nav.navigate('SavedSearches') },
      ]);
    } catch (e: any) {
      const code = String(e?.message || '');
      const msg = code.includes('too_many')
        ? 'بلغت الحد الأقصى لعمليات البحث المحفوظة (20). احذف واحدة أولاً.'
        : 'تعذّر حفظ البحث، حاول مرة أخرى.';
      Alert.alert('تعذّر الحفظ', msg);
    } finally {
      setPending(false);
    }
  }

  return { save, isPending };
}
