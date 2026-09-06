import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingQuality, type ListingQualityDraft } from '../src/lib/listingQuality.ts';
const draft: ListingQualityDraft={brand:'Apple',model:'iPhone 13 Pro',condition:'used',description:'الشاشة بلا خدوش، الهيكل عليه خدش صغير. تاريخ الإصلاح غير معروف.',images:['front','back','side']};
const ids=(changes:Partial<ListingQualityDraft>)=>listingQuality({...draft,...changes}).map(i=>i.id);
test('specific disclosure including unknown repair history satisfies completeness',()=>assert.deepEqual(ids({}),[]));
test('photo hints count distinct selected files without pretending to inspect pixels',()=>{
 assert.ok(ids({images:[]}).includes('photos'));
 assert.ok(ids({images:['front','front','back']}).includes('duplicate-selection'));
 assert.ok(ids({images:['front','front','back']}).includes('photos'));
 assert.equal(ids({images:['a','b','c']}).includes('photos'),false);
});
test('generic model names flagged while valid numeric/short/manual names remain allowed',()=>{
 for(const model of ['', 'Apple','نظيف','ايفون','هاتف'])assert.ok(ids({model}).includes('model'));
 for(const [brand,model] of [['Nokia','3310'],['Apple','iPhone X'],['Other','Fairphone 5'],['Honor','Magic V']])assert.equal(ids({brand,model}).includes('model'),false);
});
test('vague used condition needs screen/body/repair details with edit destinations',()=>{
 const issues=listingQuality({...draft,description:'نظيف'});
 for(const id of ['description','screen','body','repairs'])assert.ok(issues.some(i=>i.id===id&&i.step===2));
});
test('new devices request box/activation details rather than used-condition claims',()=>{
 assert.deepEqual(ids({condition:'new',description:'العلبة مختومة والجهاز غير مفعل.'}),[]);
 assert.ok(ids({condition:'new',description:''}).includes('new-condition'));
 assert.equal(ids({condition:'new',description:''}).includes('repairs'),false);
});
test('repaired/refurbished listings receive specific repair disclosure guidance',()=>{
 for(const condition of ['repaired','refurbished']) {
  const issue=listingQuality({...draft,condition,description:'الشاشة جيدة والهيكل بلا خدوش'}).find(i=>i.id==='repairs');
  assert.ok(issue?.advice.includes('الجزء المصلح'));
 }
});
