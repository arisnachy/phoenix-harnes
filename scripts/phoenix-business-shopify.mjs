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