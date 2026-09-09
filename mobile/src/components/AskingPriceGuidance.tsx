import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { theme, fonts, radius } from '../theme';
import { fmtIQD } from './ui';

type Props = {brand:string;model:string;storage:string;condition:string;governorate:string;askingPrice:number};
type Comparison = {count:number;median:number|null;low:number|null;high:number|null};
export function AskingPriceGuidance({askingPrice,...filters}:Props) {
  const ready = Object.values(filters).every(value => !!value?.trim());
  const query = useQuery({
    queryKey: ['asking-price-guidance', filters],
    queryFn: () => api<Comparison>('/listings/price-guidance?' +
      Object.entries(filters).map(([key,value]) => `${key}=${encodeURIComponent(value)}`).join('&')),
    enabled: ready, staleTime: 60000, retry: 1,
  });
  const result = query.data;
  const style = {fontFamily:fonts.ar,color:theme.subtle,textAlign:'right' as const,lineHeight:21};
  return <View style={{padding:14,marginBottom:12,gap:7,borderWidth:1,borderColor:theme.line,borderRadius:radius.lg,backgroundColor:theme.surface}}>
    <Text style={{...style,fontFamily:fonts.arBold,color:theme.ink}}>مقارنة أسعار الطلب</Text>
    <Text style={style}>لنفس الموديل والسعة في محافظتك، من الإعلانات النشطة خلال آخر 90 يوماً — بكل الحالات (جديد ومستعمل ومصلّح ومجدّد) معاً.</Text>
    {!ready ? <Text style={style}>اختر الموديل والسعة والمحافظة لعرض المقارنة.</Text>
      : query.isPending ? <Text style={style}>جارٍ تحميل أسعار الطلب…</Text>
      : query.isError ? <><Text style={style}>تعذر تحميل المقارنة. يمكنك متابعة النشر.</Text><TouchableOpacity accessibilityRole="button" onPress={()=>query.refetch()}><Text style={{...style,color:theme.accent}}>إعادة المحاولة</Text></TouchableOpacity></>
      : result && result.median !== null ? <>
        <Text style={{...style,color:theme.ink}}>وسيط أسعار الطلب: {fmtIQD(result.median)}</Text>
        <Text style={style}>النطاق: {fmtIQD(result.low!)} – {fmtIQD(result.high!)} · {result.count} إعلانات</Text>
        {askingPrice >= 100000 ? <Text style={style}>{askingPrice > result.median ? 'سعرك أعلى من وسيط أسعار الطلب' : askingPrice < result.median ? 'سعرك أقل من وسيط أسعار الطلب' : 'سعرك يساوي وسيط أسعار الطلب'}</Text> : null}
      </> : <Text style={style}>لا توجد بيانات كافية للمقارنة ({result?.count ?? 0} إعلانات؛ نحتاج 3 على الأقل).</Text>}
    <Text style={{...style,fontSize:12}}>هذه أسعار يطلبها البائعون، وليست أسعار صفقات مكتملة أو تقييماً مضموناً لجهازك. المقارنة تجمع كل الحالات، فجهاز جديد يُقارن بأجهزة مصلّحة أيضاً — خذها كمؤشر لا كسعر. السعر النهائي قرارك.</Text>
  </View>;
}
