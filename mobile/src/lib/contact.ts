import { Linking, Alert } from 'react-native';
import { digitsOnly } from './format';

// Local 07XXXXXXXXX → +9647XXXXXXXXX. Stripping non-digits so paste-from-
// chat-with-spaces still works, normalising Arabic-Indic numerals first
// so ٠٧٧... pastes are accepted just like 077...
function toIntl(phone: string): string {
  const d = digitsOnly(phone || '');
  if (d.startsWith('00964')) return d.slice(2);
  if (d.startsWith('964')) return d;
  if (d.startsWith('0')) return '964' + d.slice(1);
  return d;
}

export function callPhone(phone: string) {
  const intl = toIntl(phone);
  if (!intl) return;
  Linking.openURL(`tel:+${intl}`).catch(() => Alert.alert('تعذّر الاتصال'));
}

export function openWhatsApp(phone: string, prefill?: string) {
  const intl = toIntl(phone);
  if (!intl) return;
  const url = `https://wa.me/${intl}${prefill ? `?text=${encodeURIComponent(prefill)}` : ''}`;
  Linking.openURL(url).catch(() => Alert.alert('تعذّر فتح واتساب'));
}
