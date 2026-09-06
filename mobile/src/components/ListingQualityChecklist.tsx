import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';
import type { ListingQualityIssue } from '../lib/listingQuality';
export function ListingQualityChecklist({issues,onEdit,review=false}:{issues:ListingQualityIssue[];onEdit:(step:number)=>void;review?:boolean}) {
 if(!review && issues.length===0)return null;
 return <View style={{marginTop:14,padding:14,backgroundColor:theme.surface,borderColor:theme.line,borderWidth:1,borderRadius:radius.lg,gap:10}}>
  <Text style={{fontFamily:fonts.arBold,color:theme.ink,textAlign:'right'}}>راجع جودة إعلانك{issues.length?` · ${issues.length} ملاحظات`:''}</Text>
  {issues.length===0?<Text style={{fontFamily:fonts.ar,color:theme.success,textAlign:'right'}}>لا توجد ملاحظات اكتمال واضحة. راجع صحة التفاصيل والصور قبل النشر.</Text>:issues.map(issue=><View key={issue.id} style={{gap:4}}>
   <View style={{flexDirection:'row-reverse',alignItems:'center',gap:10}}><Text style={{flex:1,fontFamily:fonts.arBold,color:theme.ink,textAlign:'right'}}>{issue.title}</Text><TouchableOpacity accessibilityLabel={`تعديل: ${issue.title}`} accessibilityRole="button" onPress={()=>onEdit(issue.step)} style={{padding:8}}><Text style={{color:theme.accent,fontFamily:fonts.arBold}}>تعديل</Text></TouchableOpacity></View>
   <Text style={{fontFamily:fonts.ar,color:theme.subtle,textAlign:'right',lineHeight:21}}>{issue.advice}</Text>
  </View>)}
  <Text style={{fontFamily:fonts.ar,color:theme.subtle,textAlign:'right',fontSize:11,lineHeight:18}}>إرشادات آلية اختيارية لتحسين الوصف؛ ليست فحصاً للجهاز أو حكماً على الصور. لا تضف معلومة لا تعرفها. يبقى الحد الحالي للصور مطلوباً.</Text>
 </View>;
}
