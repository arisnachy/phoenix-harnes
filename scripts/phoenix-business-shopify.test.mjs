import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createShopifyDraft, inspectShopifyDraft} from './phoenix-business-shopify.mjs'
const revision='a'.repeat(64)
const product={id:'curso-ejemplo',title:'Curso original de automatización',description:'Aprende <JS>\ny mejora tus procesos',revision}
const config={shop:'my-test-store.myshopify.com',token:'shpat-test-token-value-not-real'}
const approval={granted:true,action:'shopify:create-draft',shop:config.shop,productId:product.id,revision}
const record={id:'gid://shopify/Product/123456',handle:'phoenix-curso-ejemplo-aaaaaaaaaaaa',title:product.title,status:'DRAFT'}
function mockApi(seq){const calls=[];return {calls,fetchImpl:async (url,opts)=>{const obj=JSON.parse(opts.body);calls.push({url,opts,obj});const data=seq.shift();if(!data)throw Error('Unexpected request');return {ok:true,status:200,json:async()=>({data})}}}}
test('denies mutations without host approval and never touches network',async()=>{
 let n=0;await assert.rejects(createShopifyDraft(config,product,{fetchImpl:()=>{n++}}),/autorización explícita/);
 await assert.rejects(createShopifyDraft(config,product,{approval:{...approval,revision:'b'.repeat(64)},fetchImpl:()=>{n++}}),/autorización explícita/);assert.equal(n,0)
})
test('creates a DRAFT via real GraphQL mutation and reconciles remote status',async()=>{
 const x=mockApi([{product:null},{productCreate:{product:record,userErrors:[]}},{product:record}]);const res=await createShopifyDraft(config,product,{approval,fetchImpl:x.fetchImpl});assert.equal(res.created,true);assert.equal(res.publiclyPublished,false);assert.equal(res.id,record.id);assert.equal(x.calls.length,3);assert(x.calls[1].obj.query.includes('productCreate'));assert.equal(x.calls[1].obj.variables.product.status,'DRAFT');assert(!JSON.stringify(res).includes(config.token));assert(x.calls[1].obj.variables.product.descriptionHtml.includes('&lt;JS&gt;'));assert(x.calls.every(c=>c.url.startsWith('https://my-test-store.myshopify.com/')));
})
test('reuses existing matching draft, does not recreate duplicate',async()=>{const x=mockApi([{product:record}]);const res=await createShopifyDraft(config,product,{approval,fetchImpl:x.fetchImpl});assert.equal(res.existing,true);assert.equal(x.calls.length,1)})
test('rejects hostile domains, remote active state and mismatched receipt',async()=>{
 await assert.rejects(createShopifyDraft({...config,shop:'evil.myshopify.com.attacker.test'},product,{approval}),/dominio/)
 const x=mockApi([{product:{...record,status:'ACTIVE'}}]);await assert.rejects(createShopifyDraft(config,product,{approval,fetchImpl:x.fetchImpl}),/no está verificado/)
})
test('never retries uncertain writes and never exposes secrets in network failure',async()=>{
 let n=0;const fn=async()=>{n++;if(n===1)return{ok:true,json:async()=>({data:{product:null}})};throw Error('sensitive token shpat-test-token-value-not-real')};await assert.rejects(createShopifyDraft(config,product,{approval,fetchImpl:fn}),err=>{assert(!err.message.includes(config.token));return true});assert.equal(n,2)
})
test('read-only inspect does not mutate',async()=>{const x=mockApi([{product:record}]);const res=await inspectShopifyDraft(config,product,{fetchImpl:x.fetchImpl});assert.equal(res.found,true);assert.equal(x.calls.length,1);assert(!x.calls[0].obj.query.includes('mutation'))})
test('one merchant approval cannot be replayed against a different shop',async()=> {
 let calls=0
 await assert.rejects(createShopifyDraft({...config,shop:'another-merchant.myshopify.com'},product,{approval,fetchImpl:()=>{calls++}}),/autorización explícita/)
 await assert.rejects(createShopifyDraft(config,product,{approval:{...approval,shop:'another-merchant.myshopify.com'},fetchImpl:()=>{calls++}}),/autorización explícita/)
 assert.equal(calls,0)
})
