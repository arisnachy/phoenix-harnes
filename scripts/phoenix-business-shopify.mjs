/** Shopify Admin API adapter. DRAFT only. No checkout, public publishing, payments or fulfillment.
 * No implicit mutation: authorization must be verified by the trusted Phoenix Host beforehand.
 * Sensitive shop token is supplied in memory by the credentials subsystem, not a CLI argument.
 */
const VERSION = '2026-10'
const PRODUCT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/
const SHOP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/
const AUTH_ERROR = 'La operación requiere autorización explícita y comprobada por Phoenix.'
const LOOKUP = 'query Lookup($identifier: ProductIdentifierInput!) { product: productByIdentifier(identifier: $identifier) { id handle title status } }'
const CREATE = 'mutation CreateDraft($product: ProductCreateInput!) { productCreate(product: $product) { product { id handle title status } userErrors { field message } } }'
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const insist = (condition, reason) => { if (!condition) throw new Error(reason) }
const formatHandle = (id, revision) => `phoenix-${id}-${revision.slice(0,12)}`

function validate(settings, product) {
  insist(settings && typeof settings === 'object', 'Falta configuración de tienda.')
  insist(typeof settings.shop === 'string' && SHOP.test(settings.shop), 'La tienda debe usar un dominio válido *.myshopify.com.')
  insist(typeof settings.token === 'string' && settings.token.length >= 12 && settings.token.length < 500, 'Credencial Shopify no disponible.')
  insist(product && typeof product === 'object' && PRODUCT_ID.test(product.id) && product.id.length <= 80, 'Identificador de producto no válido.')
  insist(typeof product.title === 'string' && product.title.trim().length >= 3 && product.title.length <= 255, 'Título de producto inválido.')
  insist(typeof product.description === 'string' && product.description.length <= 12000, 'Descripción de producto inválida.')
  insist(typeof product.revision === 'string' && /^[a-f0-9]{64}$/.test(product.revision), 'Falta la revisión SHA-256 del producto validado.')
}

async function graphql(settings, query, variables, fetchImpl) {
  const url = `https://${settings.shop}/admin/api/${VERSION}/graphql.json`
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {'content-type': 'application/json','x-shopify-access-token':settings.token},
      body: JSON.stringify({query, variables}),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
  } catch {
    // Never echo transport exceptions: URLs and access tokens can appear in error messages.
    throw new Error('No se pudo confirmar respuesta de Shopify. Conciliar antes de repetir la operación.')
  }
  insist(response && response.ok, `La API de Shopify rechazó la operación (HTTP ${Number(response?.status) || 0}).`)
  let payload
  try { payload = await response.json() } catch { throw new Error('Respuesta de Shopify inválida; comprobar estado remoto antes de repetir.') }
  insist(payload && typeof payload === 'object' && !Array.isArray(payload), 'Respuesta de Shopify malformada.')
  insist(!Array.isArray(payload.errors) || payload.errors.length === 0, 'Shopify informó un error GraphQL; revisar autorización y esquema.')
  insist(payload.data && typeof payload.data === 'object', 'Respuesta de Shopify sin datos verificables.')
  return payload.data
}

function productRecord(record, handle) {
  insist(record && typeof record === 'object' && PRODUCT_GID.test(record.id) && record.handle === handle && record.status === 'DRAFT', 'El producto Shopify no está verificado como borrador propio.')
  return {id:record.id,handle:record.handle,status:'DRAFT',publiclyPublished:false,ordersVerified:0,paid:false}
}

/** The caller MUST verify approval at a trusted host boundary; this function checks a bound receipt, not UI text. */
export async function createShopifyDraft(settings, product, {approval, fetchImpl=fetch}={}) {
  validate(settings, product)
  insist(approval && approval.granted === true && approval.action === 'shopify:create-draft' && approval.shop === settings.shop && approval.productId === product.id && approval.revision === product.revision, AUTH_ERROR)
  const handle = formatHandle(product.id, product.revision)
  const lookup = async () => (await graphql(settings,LOOKUP,{identifier:{handle}},fetchImpl)).product
  const prior=await lookup()
  if (prior !== null && prior !== undefined) return {created:false,existing:true,shop:settings.shop,...productRecord(prior,handle)}
  const input = {title:product.title.trim(),handle,status:'DRAFT',descriptionHtml:`<p>${escapeHtml(product.description).replace(/\n/g,'</p><p>')}</p>`}
  const created=await graphql(settings,CREATE,{product:input},fetchImpl)
  insist(Array.isArray(created.productCreate?.userErrors) && created.productCreate.userErrors.length===0, 'Shopify rechazó los datos del borrador.')
  const initial=productRecord(created.productCreate?.product,handle)
  const confirmed=productRecord(await lookup(),handle)
  insist(initial.id===confirmed.id, 'Respuesta de Shopify inconsistente; comprobar borrador antes de continuar.')
  return {created:true,existing:false,shop:settings.shop,...confirmed}
}

/** Read-only proof. It does not assert public publication, payment or digital delivery. */
export async function inspectShopifyDraft(settings, product, {fetchImpl=fetch}={}) {
  validate(settings,product)
  const handle=formatHandle(product.id,product.revision)
  const record=(await graphql(settings,LOOKUP,{identifier:{handle}},fetchImpl)).product
  if (record == null) return {found:false,shop:settings.shop,publiclyPublished:false}
  return {found:true,shop:settings.shop,...productRecord(record,handle)}
}


/**
 * Price the SINGLE initial Shopify draft variant without activating a sales channel.
 * Must be called only after the trusted Host verifies a fresh approval. A caller-supplied
 * approval object is NOT cryptographic authorization, and this module cannot mint one.
 * The Host must also serialize jobs for each (shop, product, revision).
 */
const PRICE_LOOKUP = 'query LookupDraftPrice($identifier: ProductIdentifierInput!) { shop { currencyCode } product: productByIdentifier(identifier: $identifier) { id handle title status variants(first: 2) { nodes { id price } } } }'
const PRICE_UPDATE = 'mutation SetDraftPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) { product { id } productVariants { id price } userErrors { field message } } }'
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]*$/

function canonicalPrice(value) {
  const raw = String(value)
  insist(/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,2})?$/.test(raw), 'Precio inválido: se requieren hasta dos decimales.')
  const number = Number(raw)
  insist(Number.isFinite(number) && number > 0 && number <= 10000, 'Precio fuera del intervalo permitido.')
  return number.toFixed(2)
}

function draftPriceSnapshot(data, product, settings) {
  insist(data && data.shop && typeof data.shop.currencyCode === 'string', 'No se pudo verificar la moneda de la tienda.')
  insist(data.shop.currencyCode === product.currency, 'La moneda solicitada no coincide con la moneda de la tienda Shopify.')
  const expectedHandle = formatHandle(product.id, product.revision)
  const remote = data.product
  const identity = productRecord(remote, expectedHandle)
  insist(remote.title === product.title.trim(), 'El título del producto remoto cambió: se requiere revisión manual.')
  const nodes = remote.variants?.nodes
  insist(Array.isArray(nodes) && nodes.length === 1 && VARIANT_GID.test(nodes[0]?.id), 'Se requiere exactamente una variante Shopify válida.')
  const current = nodes[0]
  insist(typeof current.price === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(current.price),
    'El precio remoto no es verificable.')
  return { ...identity, variantId: current.id, price: Number(current.price).toFixed(2), currency: data.shop.currencyCode }
}

/**
 * Configure a price only on an existing DRAFT with its untouched default variant.
 * Reads before/after mutation and never retries an uncertain write. No orders or
 * paid amounts are claimed; Shopify publication, taxes and delivery remain separate.
 */
export async function configureShopifyDraftPrice(settings, product, { approval, fetchImpl = fetch } = {}) {
  validate(settings, product)
  insist(product.currency && /^[A-Z]{3}$/.test(product.currency), 'Moneda ISO 4217 inválida.')
  const price = canonicalPrice(product.price)
  insist(approval && approval.granted === true &&
    approval.action === 'shopify:set-draft-price' &&
    approval.shop === settings.shop &&
    approval.productId === product.id &&
    approval.revision === product.revision &&
    approval.price === price &&
    approval.currency === product.currency, AUTH_ERROR)
  const variables = { identifier: { handle: formatHandle(product.id, product.revision) } }
  const before = draftPriceSnapshot(await graphql(settings, PRICE_LOOKUP, variables, fetchImpl), product, settings)
  if (before.price === price) {
    return { configured: true, reused: true, shop: settings.shop, ...before, publiclyPublished: false, ordersVerified: 0, paid: false }
  }
  // Refuse to overwrite a merchant-modified price: default variant starts at zero.
  insist(before.price === '0.00', 'El precio existente difiere del esperado; revisión manual obligatoria.')
  const changed = await graphql(settings, PRICE_UPDATE, {
    productId: before.id, variants: [{ id: before.variantId, price }],
  }, fetchImpl)
  const outcome = changed.productVariantsBulkUpdate
  insist(Array.isArray(outcome?.userErrors) && outcome.userErrors.length === 0 &&
    outcome.product?.id === before.id &&
    Array.isArray(outcome.productVariants) && outcome.productVariants.length === 1 &&
    outcome.productVariants[0]?.id === before.variantId,
    'Shopify no confirmó la actualización de la variante; conciliar antes de repetir.')
  const after = draftPriceSnapshot(await graphql(settings, PRICE_LOOKUP, variables, fetchImpl), product, settings)
  insist(after.id === before.id && after.variantId === before.variantId && after.price === price,
    'No se verificó el precio final; conciliar antes de repetir.')
  return { configured: true, reused: false, shop: settings.shop, ...after, publiclyPublished: false, ordersVerified: 0, paid: false }
}
