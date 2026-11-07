import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const data=JSON.parse(readFileSync(fileURLToPath(new URL('./phoenix-anatomy-models.json',import.meta.url)),'utf8'))
test('all catalog tasks require verified provenance, modality and explicit research classification',()=>{
 assert.equal(data.clinicalUse,'research-only')
 assert.equal(data.schema,1)
 const seen=new Set()
 for(const row of data.tasks){
  assert.ok(!seen.has(row.id));seen.add(row.id)
  assert.match(row.verifiedSource,/^https:\/\/github\.com\/wasserth\/TotalSegmentator$/)
  assert.ok(['ct','mr'].includes(row.modality))
  assert.ok(['Apache-2.0','vendor-license-required'].includes(row.licensed))
  assert.ok(row.limits)
 }
})
test('unobservable anatomy cannot silently become a segmentation task',()=>{
 assert.ok(data.gaps.some(x=>x.structure.includes('coronarias')))
 assert.ok(data.gaps.some(x=>x.structure.includes('nervios periféricos')))
 assert.ok(data.gaps.some(x=>x.status==='not_observable_at_standard_ct_resolution'))
})

test('specialist cardiovascular, neurologic and limb task requires licensing gate',()=>{
 const ids=['ct_coronary_arteries','ct_heart_highres','ct_brain_regions','ct_appendicular_bones','ct_thigh_shoulder_muscles']
 for(const id of ids){
  const item=data.tasks.find(x=>x.id===id)
  assert.ok(item,id)
  assert.equal(item.licensed,'vendor-license-required')
 }
})
