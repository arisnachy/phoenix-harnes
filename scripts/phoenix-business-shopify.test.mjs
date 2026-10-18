import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createShopifyDraft, inspectShopifyDraft, configureShopifyDraftPrice} from './phoenix-business-shopify.mjs'
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


const priced = { ...product, currency: 'USD', price: '29.99' }
const pricingApproval = {
  granted: true, action: 'shopify:set-draft-price', shop: config.shop,
  productId: priced.id, revision: priced.revision, price: '29.99', currency: 'USD',
}
const variantId = 'gid://shopify/ProductVariant/777'
const pricedResponse = (price, currency = 'USD', overrides = {}) => ({
  shop: { currencyCode: currency },
  product: { ...record, variants: { nodes: [{ id: variantId, price }] }, ...overrides },
})

test('sets single draft price with official mutation, checks currency and readback', async () => {
  const api = mockApi([
    pricedResponse('0.00'),
    { productVariantsBulkUpdate: {
      product: { id: record.id }, productVariants: [{ id: variantId, price: '29.99' }], userErrors: [],
    } },
    pricedResponse('29.99'),
  ])
  const result = await configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: api.fetchImpl })
  assert.equal(result.configured, true)
  assert.equal(result.reused, false)
  assert.equal(result.price, '29.99')
  assert.equal(result.currency, 'USD')
  assert.equal(result.publiclyPublished, false)
  assert.equal(result.ordersVerified, 0)
  assert.equal(result.paid, false)
  assert.equal(api.calls.length, 3)
  assert.equal(api.calls[1].obj.variables.productId, record.id)
  assert.deepEqual(api.calls[1].obj.variables.variants, [{ id: variantId, price: '29.99' }])
  assert(api.calls[1].obj.query.includes('productVariantsBulkUpdate'))
  assert(!JSON.stringify(result).includes(config.token))
})

test('existing correct draft price is read-only and idempotent', async () => {
  const api = mockApi([pricedResponse('29.99')])
  const result = await configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: api.fetchImpl })
  assert.equal(result.reused, true)
  assert.equal(api.calls.length, 1)
  assert(!api.calls[0].obj.query.includes('mutation'))
})

test('price changes require new host approval, no implicit writes', async () => {
  let network = 0
  const fetchImpl = () => { network++; throw Error('unexpected network') }
  for (const input of [
    { ...priced, price: '30.00' },
    { ...priced, currency: 'DOP' },
    { ...priced, price: '1.005' },
    { ...priced, price: '1e3' },
  ]) {
    await assert.rejects(configureShopifyDraftPrice(config, input, { approval: pricingApproval, fetchImpl }))
  }
  await assert.rejects(configureShopifyDraftPrice(config, priced, { approval: { ...pricingApproval, shop: 'other.myshopify.com' }, fetchImpl }), /autorización explícita/)
  assert.equal(network, 0)
})

test('mismatched store currency and manually changed prices fail closed', async () => {
  const currency = mockApi([pricedResponse('0.00', 'DOP')])
  await assert.rejects(configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: currency.fetchImpl }), /moneda/)
  assert.equal(currency.calls.length, 1)
  const drift = mockApi([pricedResponse('20.00')])
  await assert.rejects(configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: drift.fetchImpl }), /revisión manual/)
  assert.equal(drift.calls.length, 1)
})

test('rejects multiple variants, altered title, and active products', async () => {
  for (const response of [
    pricedResponse('0.00', 'USD', { variants: { nodes: [{ id: variantId, price: '0.00' }, { id: 'gid://shopify/ProductVariant/888', price: '0.00' }] } }),
    pricedResponse('0.00', 'USD', { title: 'Different product title' }),
    pricedResponse('0.00', 'USD', { status: 'ACTIVE' }),
  ]) {
    const api = mockApi([response])
    await assert.rejects(configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: api.fetchImpl }))
    assert.equal(api.calls.length, 1)
  }
})

test('unconfirmed price update fails without another write or secret leak', async () => {
  const api = mockApi([
    pricedResponse('0.00'),
    { productVariantsBulkUpdate: {
      product: { id: record.id }, productVariants: [{ id: variantId, price: '29.99' }], userErrors: [],
    } },
    pricedResponse('0.00'),
  ])
  await assert.rejects(configureShopifyDraftPrice(config, priced, { approval: pricingApproval, fetchImpl: api.fetchImpl }),
    err => { assert.match(err.message, /conciliar/); assert(!err.message.includes(config.token)); return true })
  assert.equal(api.calls.filter(call => call.obj.query.includes('mutation')).length, 1)
})
