import React, { useState } from 'react';
import { View, Text, Alert, Linking } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Features, type FeatureRequest } from '../api/endpoints';
import { Btn, Input, FieldLabel, fmtIQD } from './ui';
import { theme, fonts, radius } from '../theme';

export function PromotionPayment({ request, supportPhone }: { request: FeatureRequest; supportPhone?: string }) {
  const [reference, setReference] = useState('');
  const qc = useQueryClient();
  const canPay = request.listing_status === 'active' || request.listing_status === 'reserved';
  const reported = request.payment_state === 'reported';
  const legacy = !request.payment_state || request.payment_state === 'legacy_unconfirmed';
  let destination: {number?:string;name?:string;code?:string} = {};
  try { destination = JSON.parse(request.payment_destination_json || '{}') || {}; } catch {}
  const refresh = () => qc.invalidateQueries({queryKey:['features-mine']});
  const report = useMutation({
    mutationFn: () => Features.reportPayment(request.id, reference.trim()),
    onSuccess: refresh,
    onError: () => { refresh(); Alert.alert('تعذر تحديث الدفع', 'تحقق من حالة الطلب وأعد المحاولة. لا تحوّل المبلغ مرة ثانية.'); },
  });
  function pay() {
    if (destination.code) {
      Linking.openURL('tel:' + encodeURIComponent(destination.code)).catch(() =>
        Alert.alert('اطلب رمز التحويل من تطبيق الهاتف', destination.code));
    } else {
      Alert.alert('إكمال الدفع من تطبيق Qi',
        `حوّل ${fmtIQD(request.amount)} إلى ${destination.number} باسم ${destination.name || 'الحساب الموضح'}، ثم ارجع واضغط «حوّلت المبلغ».`);
    }
  }
  const textStyle = { fontFamily:fonts.ar, color:theme.subtle, textAlign:'right' as const, lineHeight:22 };
  return <View style={{backgroundColor:theme.surface,padding:16,borderWidth:1,borderColor:theme.line,borderRadius:radius.xxl,gap:12,marginBottom:16}}>
    <Text style={{...textStyle,fontFamily:fonts.arBold,color:theme.ink}}>
      {reported ? 'أبلغت عن الدفع — بانتظار التحقق' : legacy ? 'طلب سابق — حالة الدفع غير مؤكدة' : 'بانتظار الدفع — التمييز غير مفعّل'}
    </Text>
    <Text style={textStyle}>طلب #{request.id} · {fmtIQD(request.amount)} · {request.days} أيام · {request.boosts_per_day} مرات رفع يومياً</Text>
    <Text style={textStyle}>{reported
      ? 'لا تحوّل المبلغ مرة ثانية. سنراجع وصوله، ويبدأ التمييز بعد التحقق والتفعيل.'
      : legacy ? 'إذا حوّلت المبلغ سابقاً، أبلغنا أدناه ولا تدفع مرة ثانية. إذا لم تحوّل، تواصل معنا لتأكيد حساب الاستلام لهذا الطلب.'
      : 'حفظ الطلب أو فتح الاتصال لا يعني إتمام الدفع. أكمل التحويل من الشريحة الصحيحة ثم ارجع وأبلغنا.'}</Text>
    {request.sender_name || request.sender_phone ? <Text selectable style={textStyle}>المرسل: {request.sender_name || request.sender_phone}</Text> : null}
    {destination.number ? <Text selectable style={textStyle}>حساب الاستلام: {destination.number}{destination.name ? ` · ${destination.name}` : ''}</Text> : null}
    {!reported && !legacy && destination.code ? <Text selectable style={{...textStyle,writingDirection:'ltr',textAlign:'center'}}>{destination.code}</Text> : null}
    {!canPay ? <Text style={textStyle}>الإعلان غير متاح للترويج حالياً. لا تحوّل مبلغاً جديداً. إذا دفعت سابقاً، أبلغنا وتواصل مع الدعم.</Text> : null}
    {!reported ? <>
      {!legacy && canPay && destination.number ? <Btn full kind="accent" onPress={pay}>إكمال الدفع</Btn> : null}
      <FieldLabel>رقم العملية أو مرجع التحويل (اختياري)</FieldLabel>
      <Input value={reference} onChangeText={value=>setReference(value.slice(0,120))} placeholder="يساعدنا على مطابقة التحويل؛ لا تكتب رمزاً سرياً" />
      <Btn full busy={report.isPending} onPress={()=>Alert.alert('هل أكملت التحويل؟',
        'هذا بلاغ للمراجعة فقط. يُفعّل التمييز بعد تأكيد وصول المبلغ.',
        [{text:'رجوع',style:'cancel'},{text:'نعم، حوّلت المبلغ',onPress:()=>report.mutate()}])}>
        حوّلت المبلغ — تحقق من الدفع
      </Btn>
    </> : request.payment_reference ? <Text selectable style={textStyle}>مرجع التحويل: {request.payment_reference}</Text> : null}
    {supportPhone ? <Btn full kind="ghost" onPress={()=>Linking.openURL('tel:'+supportPhone).catch(()=>Alert.alert('اتصل بالدعم',supportPhone))}>{`أحتاج مساعدة · طلب #${request.id}`}</Btn> : null}
    <Btn full kind="ghost" onPress={refresh}>تحديث حالة الطلب</Btn>
  </View>;
}
