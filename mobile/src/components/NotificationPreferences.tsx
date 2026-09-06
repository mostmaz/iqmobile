import React from 'react';
import { View, Text, Switch, TouchableOpacity } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Notifications } from '../api/endpoints';
import { theme, fonts } from '../theme';
export function NotificationPreferencesPanel() {
 const qc=useQueryClient();
 const query=useQuery({queryKey:['notification-preferences'],queryFn:Notifications.preferences});
 const mutation=useMutation({mutationFn:Notifications.updatePreferences,onSuccess:data=>qc.setQueryData(['notification-preferences'],data)});
 const p=query.data;
 if(!p)return <Text style={{color:theme.subtle,fontFamily:fonts.ar,textAlign:'right'}}>{query.isError?'تعذّر تحميل تفضيلات التنبيه. اسحب للتحديث أو أعد فتح الصفحة.':'جارٍ تحميل تفضيلات التنبيه…'}</Text>;
 const toggle=(key:string,value:boolean)=>mutation.mutate(key==='seller_summary'&&!value?{seller_summary:false,experiment:false}:{[key]:value});
 return <View style={{padding:14,marginBottom:16,backgroundColor:theme.surface,borderRadius:12,gap:8}}>
  <Text style={{fontFamily:fonts.arBold,color:theme.ink,textAlign:'right'}}>تفضيلات التنبيهات</Text>
  {([['matches','مطابقات البحث المحفوظ وقائمة الرغبات'],['prices','انخفاض سعر إعلان أراقبه'],['chat_push','إشعارات رسائل المشترين والمحادثات'],['seller_summary','ملخص أداء إعلاناتي أسبوعياً']] as const).map(([key,label])=><View key={key} style={{flexDirection:'row-reverse',alignItems:'center',gap:10}}><Text style={{flex:1,fontFamily:fonts.ar,color:theme.ink,textAlign:'right'}}>{label}</Text><Switch accessibilityLabel={label} value={!!p[key]} disabled={mutation.isPending} onValueChange={v=>toggle(key,v)}/></View>)}
  <Text style={{fontFamily:fonts.ar,color:theme.subtle,textAlign:'right'}}>تنبيهات المطابقة تتطلب حفظ بحث أو جهاز وتفعيل تنبيهاته. الملخص يبدأ بعد أسبوع من التفعيل، للمخزون النشط فقط.</Text>
  <Text style={{fontFamily:fonts.ar,color:theme.ink,textAlign:'right'}}>الحد اليومي لتنبيهات المطابقة والسعر والملخص</Text>
  <View style={{flexDirection:'row-reverse',gap:12}}>{[1,3,5].map(n=><TouchableOpacity key={n} accessibilityRole="button" accessibilityState={{selected:p.daily_limit===n}} disabled={mutation.isPending} onPress={()=>mutation.mutate({daily_limit:n})} style={{padding:10,backgroundColor:p.daily_limit===n?theme.accentSoft:theme.bg,borderRadius:8}}><Text style={{color:theme.ink}}>{n}</Text></TouchableOpacity>)}</View>
  <Text style={{fontFamily:fonts.ar,color:theme.subtle,textAlign:'right'}}>بين ٩ صباحاً و٩ مساءً بتوقيت بغداد، وبفاصل ساعة على الأقل. ما يتجاوز الحد يبقى داخل صندوق التنبيهات فقط. رسائل المحادثة خارج هذه الحدود وتبقى في الصندوق عند إيقاف إشعاراتها.</Text>
  {p.seller_summary ? <View><View style={{flexDirection:'row-reverse',alignItems:'center',gap:10}}><Text style={{flex:1,fontFamily:fonts.ar,color:theme.ink,textAlign:'right'}}>أشارك اختيارياً في تقييم الملخص</Text><Switch accessibilityLabel="المشاركة في تقييم الملخص" value={!!p.experiment} disabled={mutation.isPending} onValueChange={v=>toggle('experiment',v)}/></View><Text style={{fontFamily:fonts.ar,color:theme.subtle,textAlign:'right'}}>نقارن العودة والتواصل وإيقاف التنبيهات. نصف المشاركين لا يتلقون الملخص الجديد أثناء التقييم؛ تنبيهاتهم الأخرى لا تتغير. يمكنك الانسحاب متى شئت.{p.experiment ? (p.experiment_group==='control'?' مجموعتك: بدون ملخص.':' مجموعتك: مع ملخص.') : ''}</Text></View>:null}
  {mutation.isError?<Text style={{color:theme.accent,fontFamily:fonts.ar,textAlign:'right'}}>تعذّر حفظ التغيير، حاول مجدداً.</Text>:null}
 </View>;
}
