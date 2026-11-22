/**
 * Read-only integration with the REAL protected /health operator console.
 * This never copies CSRF, cookie, clinical records, identities or patient
 * data into PHOENIX chat, local storage, workspace events or logs.
 */
export type ClinicalRouteStatus = {
  readonly status: 'authenticated'|'locked'|'unavailable'
  readonly role: 'admin'|'clinician'|'psychologist'|'nurse'|'reception'|'lab'|'radiology'|'pharmacy'|'billing'|null
  readonly patientPortal: 'not-verified'
}
const ROLES = [
  'admin','clinician','psychologist','nurse','reception','lab',
  'radiology','pharmacy','billing',
] as const
/** Probe existing authority; never infer authentication from the UI role selector. */
export async function probeClinicalSession(fetcher?:typeof fetch):Promise<ClinicalRouteStatus> {
  const locked: ClinicalRouteStatus = {status:'locked',role:null,patientPortal:'not-verified'}
  try {
    const request = fetcher ?? (typeof fetch === 'function' ? fetch : undefined)
    if (!request) return {status:'unavailable',role:null,patientPortal:'not-verified'}
    const response = await request('/health/api/session',{
      method:'GET',cache:'no-store',credentials:'same-origin',
      headers:{accept:'application/json'},
      signal:AbortSignal.timeout(3000),
    })
    if (response.status === 401) return locked
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return {
      status:'unavailable',role:null,patientPortal:'not-verified',
    }
    const body:unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return locked
    const actor = (body as {actor?:unknown}).actor
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return locked
    const role=(actor as {role?:unknown}).role
    if (typeof role !== 'string' || !ROLES.some(value => value===role)) return locked
    // Explicit whitelist: the Host also returns a CSRF token; discard it and
    // all names/org/session metadata before returning to the nonclinical UI.
    return {status:'authenticated',role:role as ClinicalRouteStatus['role'],patientPortal:'not-verified'}
  } catch {return {status:'unavailable',role:null,patientPortal:'not-verified'}}
}
