
/** PHOENIX Health Engine — executable multi-module synthetic clinical sandbox.
 * No PHI, user-provided identifiers, external integrations or durable medical records.
 * Reuse these domain contracts only after replacing the authorization/persistence boundary.
 */
/** Synthetic domain ClinicRole: documented type in the bounded PHOENIX clinical contract. */
export type ClinicRole = 'clinician' | 'psychologist' | 'receptionist' | 'laboratory' | 'radiologist' | 'pharmacist' | 'billing'
/** Synthetic domain ClinicModule: documented type in the bounded PHOENIX clinical contract. */
export type ClinicModule = 'patients' | 'consultations' | 'psychology' | 'appointments' | 'laboratory' | 'imaging' | 'pharmacy' | 'billing'
/** Synthetic domain OrderKind: documented type in the bounded PHOENIX clinical contract. */
export type OrderKind = 'laboratory' | 'imaging'
/** Synthetic domain ClinicActor: documented interface in the bounded PHOENIX clinical contract. */
export interface ClinicActor {
  readonly organization: string
  readonly staffId: string
  readonly role: ClinicRole
}
/** Synthetic domain PatientRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface PatientRecord {
  readonly id: string
  readonly organization: string
  readonly synthetic: true
  readonly display: string
  readonly createdAt: string
}
/** Synthetic domain AppointmentRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface AppointmentRecord {
  readonly id: string
  readonly patientId: string
  readonly organization: string
  readonly practitionerId: string
  readonly at: string
  status: 'scheduled' | 'completed' | 'cancelled'
}
/** Synthetic domain EncounterRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface EncounterRecord {
  readonly id: string
  readonly organization: string
  readonly patientId: string
  readonly practitionerId: string
  readonly specialty: string
  readonly complaint: string
  stage: 'open' | 'draft' | 'reviewed' | 'signed'
  readonly openedAt: string
  notes: string
  revision: number
  reviewedRevision: number | null
  signedBy: string | null
}
/** Synthetic domain OrderRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface OrderRecord {
  readonly id: string
  readonly organization: string
  readonly encounterId: string
  readonly kind: OrderKind
  readonly description: string
  status: 'ordered' | 'completed'
  report: string | null
  reviewedBy: string | null
}
/** Synthetic domain MedicationRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface MedicationRecord {
  readonly id: string
  readonly organization: string
  readonly encounterId: string
  readonly medication: string
  readonly instructions: string
  readonly signedBy: string
  dispensedBy: string | null
}
/** Synthetic domain InventoryRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface InventoryRecord {
  readonly sku: string
  readonly organization: string
  quantity: number
  readonly unit: string
}
/** Synthetic domain InvoiceRecord: documented interface in the bounded PHOENIX clinical contract. */
export interface InvoiceRecord {
  readonly id: string
  readonly organization: string
  readonly patientId: string
  readonly description: string
  readonly amount: number
  paid: number
}
/** Synthetic domain ClinicAuditEvent: documented interface in the bounded PHOENIX clinical contract. */
export interface ClinicAuditEvent {
  readonly at: string
  readonly organization: string
  readonly actor: string
  readonly action: string
  readonly record: string
}
/** Synthetic domain ClinicSnapshot: documented interface in the bounded PHOENIX clinical contract. */
export interface ClinicSnapshot {
  readonly patients: readonly PatientRecord[]
  readonly appointments: readonly AppointmentRecord[]
  readonly encounters: readonly EncounterRecord[]
  readonly orders: readonly OrderRecord[]
  readonly medications: readonly MedicationRecord[]
  readonly inventory: readonly InventoryRecord[]
  readonly invoices: readonly InvoiceRecord[]
  readonly audit: readonly ClinicAuditEvent[]
}
const ROLE_ACCESS: Readonly<Record<ClinicModule, readonly ClinicRole[]>> = {
  patients: ['clinician','psychologist','receptionist'],
  consultations: ['clinician','psychologist'],
  psychology: ['psychologist'],
  appointments: ['clinician','psychologist','receptionist'],
  laboratory: ['clinician','laboratory'],
  imaging: ['clinician','radiologist'],
  pharmacy: ['clinician','pharmacist'],
  billing: ['billing'],
}
function checked(value: string, label: string, max=2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\u0000-\u001f]/u.test(value)) throw new TypeError(label+' inválido.')
  return value.trim()
}
function iso(value: string): string {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new TypeError('Fecha inválida.')
  return new Date(value).toISOString()
}
function money(value: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('El importe en centavos debe ser un entero no negativo.')
  return value
}
/** Bounded, non-persistent synthetic domain with role and organization isolation. */
export class ClinicSandbox {
  readonly #patients = new Map<string,PatientRecord>()
  readonly #appointments = new Map<string,AppointmentRecord>()
  readonly #encounters = new Map<string,EncounterRecord>()
  readonly #orders = new Map<string,OrderRecord>()
  readonly #medications = new Map<string,MedicationRecord>()
  readonly #inventory = new Map<string,InventoryRecord>()
  readonly #invoices = new Map<string,InvoiceRecord>()
  readonly #audit: ClinicAuditEvent[] = []
  #next = 0
  /** Institution to which this synthetic test sandbox is scoped. */
  readonly organization: string
  /** Clock seam for deterministic synthetic clinical tests. */
  readonly clock: () => string
  constructor(organization: string, clock: () => string = () => new Date().toISOString()) {
    this.organization = checked(organization,'Organización',100)
    this.clock = clock
  }
  #authorize(actor: ClinicActor, module: ClinicModule): void {
    const actorInput: unknown = actor
    if (typeof actorInput !== 'object' || actorInput === null ||
        actor.organization !== this.organization || !actor.staffId ||
        !ROLE_ACCESS[module].includes(actor.role)) throw new Error('Acceso clínico denegado.')
  }
  #id(prefix: string): string { this.#next++; return prefix+'-'+String(this.#next).padStart(4,'0') }
  #event(actor: ClinicActor, action: string, record: string): void {
    this.#audit.push(Object.freeze({ at:iso(this.clock()),organization:this.organization,actor:actor.staffId,action,record }))
  }
  #patient(id: string): PatientRecord {
    const item = this.#patients.get(id)
    if (!item) throw new Error('Paciente no encontrado en esta institución.')
    return item
  }
  #encounter(id: string): EncounterRecord {
    const item = this.#encounters.get(id)
    if (!item) throw new Error('Episodio no encontrado en esta institución.')
    return item
  }
  #clinician(actor: ClinicActor, episode: EncounterRecord): void {
    this.#authorize(actor,'consultations')
    if (actor.staffId !== episode.practitionerId) throw new Error('Solo el profesional responsable puede validar este episodio.')
  }
  /** Seed only clearly fictional patient labels. This store is never an EHR. */
  /**
   * Operate the synthetic test-only step registerSyntheticPatient within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param syntheticLabel - Validated syntheticLabel input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  registerSyntheticPatient(actor: ClinicActor, syntheticLabel: string): PatientRecord {
    this.#authorize(actor,'patients')
    const label=checked(syntheticLabel,'Etiqueta ficticia',90)
    if (!/^DEMO[- ]/iu.test(label)) throw new Error('Solo se admiten pacientes ficticios etiquetados DEMO.')
    const p=Object.freeze({ id:this.#id('patient'), organization:this.organization,synthetic:true as const,
      display:label, createdAt:iso(this.clock()) })
    this.#patients.set(p.id,p);this.#event(actor,'patient.create',p.id);return p
  }
  /**
   * Operate the synthetic test-only step schedule within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param patientId - Validated patientId input for this clinical operation.
   * @param practitionerId - Validated practitionerId input for this clinical operation.
   * @param at - Validated at input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  schedule(actor: ClinicActor, patientId: string, practitionerId: string, at: string): AppointmentRecord {
    this.#authorize(actor,'appointments');this.#patient(patientId)
    const date=iso(at);const clinician=checked(practitionerId,'Profesional',100)
    if ([...this.#appointments.values()].some(a=>a.practitionerId===clinician&&a.at===date&&a.status==='scheduled')) throw new Error('El profesional ya tiene una cita en ese horario.')
    const appointment: AppointmentRecord={ id:this.#id('appointment'),organization:this.organization,patientId,
      practitionerId:clinician,at:date,status:'scheduled' }
    this.#appointments.set(appointment.id,appointment);this.#event(actor,'appointment.schedule',appointment.id)
    return { ...appointment }
  }
  /**
   * Operate the synthetic test-only step open within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param patientId - Validated patientId input for this clinical operation.
   * @param specialty - Validated specialty input for this clinical operation.
   * @param complaint - Validated complaint input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  open(actor: ClinicActor, patientId: string, specialty: string, complaint: string): EncounterRecord {
    this.#authorize(actor,'consultations');this.#patient(patientId)
    const e: EncounterRecord={ id:this.#id('encounter'),organization:this.organization,patientId,
      practitionerId:actor.staffId,specialty:checked(specialty,'Especialidad',100),
      complaint:checked(complaint,'Motivo de consulta',500),notes:'',stage:'open',revision:0,
      reviewedRevision:null,signedBy:null,openedAt:iso(this.clock()) }
    this.#encounters.set(e.id,e);this.#event(actor,'encounter.open',e.id);return { ...e }
  }
  /**
   * Operate the synthetic test-only step document within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param encounterId - Validated encounterId input for this clinical operation.
   * @param text - Validated text input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  document(actor: ClinicActor, encounterId: string, text: string): EncounterRecord {
    const e=this.#encounter(encounterId);this.#clinician(actor,e)
    if(e.stage==='signed')throw new Error('No se permite modificar una historia firmada.')
    e.notes=checked(text,'Nota de demostración',3000);e.stage='draft';e.revision++
    e.reviewedRevision=null;this.#event(actor,'encounter.draft',e.id);return { ...e }
  }
  /**
   * Operate the synthetic test-only step review within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param encounterId - Validated encounterId input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  review(actor: ClinicActor, encounterId: string): EncounterRecord {
    const e=this.#encounter(encounterId);this.#clinician(actor,e)
    if(e.stage!=='draft'||!e.notes)throw new Error('Se requiere borrador clínico antes de revisar.')
    e.reviewedRevision=e.revision;e.stage='reviewed'
    this.#event(actor,'encounter.review',e.id);return { ...e }
  }
  /**
   * Operate the synthetic test-only step sign within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param encounterId - Validated encounterId input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  sign(actor: ClinicActor, encounterId: string): EncounterRecord {
    const e=this.#encounter(encounterId);this.#clinician(actor,e)
    if(e.stage!=='reviewed'||e.reviewedRevision!==e.revision)throw new Error('Debe revisarse la versión actual antes de firmar.')
    e.stage='signed';e.signedBy=actor.staffId;this.#event(actor,'encounter.sign',e.id);return { ...e }
  }
  /**
   * Operate the synthetic test-only step requestStudy within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param encounterId - Validated encounterId input for this clinical operation.
   * @param kind - Validated kind input for this clinical operation.
   * @param description - Validated description input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  requestStudy(actor: ClinicActor, encounterId: string, kind: OrderKind, description: string): OrderRecord {
    const e=this.#encounter(encounterId);this.#clinician(actor,e)
    if(actor.role!=='clinician')throw new Error('Las órdenes médicas requieren un prescriptor habilitado.')
    if(e.stage!=='signed'||e.signedBy===null)throw new Error('Las órdenes requieren una consulta firmada.')
    const requestedKind: unknown = kind
    if(requestedKind!=='laboratory'&&requestedKind!=='imaging')throw new TypeError('Tipo de estudio inválido.')
    const order: OrderRecord={ id:this.#id('order'),organization:this.organization,encounterId,kind,
      description:checked(description,'Estudio',300),status:'ordered',report:null,reviewedBy:null }
    this.#orders.set(order.id,order);this.#event(actor,'order.create',order.id);return { ...order }
  }
  /**
   * Operate the synthetic test-only step reportStudy within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param orderId - Validated orderId input for this clinical operation.
   * @param report - Validated report input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  reportStudy(actor: ClinicActor, orderId: string, report: string): OrderRecord {
    const o=this.#orders.get(orderId);if(!o)throw new Error('Orden no encontrada.')
    this.#authorize(actor,o.kind==='laboratory'?'laboratory':'imaging')
    if(o.status!=='ordered')throw new Error('Informe ya emitido.')
    if(o.kind==='imaging'&&actor.role!=='radiologist')throw new Error('El informe radiológico necesita un especialista habilitado.')
    if(o.kind==='laboratory'&&actor.role!=='laboratory')throw new Error('El laboratorio necesita personal habilitado.')
    o.status='completed';o.report=checked(report,'Resultado',1200)
    this.#event(actor,'order.report',o.id);return { ...o }
  }
  /**
   * Operate the synthetic test-only step reviewStudy within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param orderId - Validated orderId input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  reviewStudy(actor: ClinicActor, orderId: string): OrderRecord {
    const o=this.#orders.get(orderId);if(!o)throw new Error('Orden no encontrada.')
    const e=this.#encounter(o.encounterId);this.#clinician(actor,e)
    if(o.status!=='completed')throw new Error('El estudio aún no tiene resultados.')
    o.reviewedBy=actor.staffId;this.#event(actor,'order.review',o.id);return { ...o }
  }
  /**
   * Operate the synthetic test-only step prescribe within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param encounterId - Validated encounterId input for this clinical operation.
   * @param medication - Validated medication input for this clinical operation.
   * @param instructions - Validated instructions input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  prescribe(actor: ClinicActor, encounterId: string, medication: string, instructions: string): MedicationRecord {
    const e=this.#encounter(encounterId);this.#clinician(actor,e)
    if(actor.role!=='clinician')throw new Error('La prescripción requiere un prescriptor habilitado.')
    if(e.stage!=='signed')throw new Error('Debe firmarse la consulta antes de prescribir.')
    const rx: MedicationRecord={ id:this.#id('rx'),organization:this.organization,encounterId,
      medication:checked(medication,'Medicamento',160),instructions:checked(instructions,'Indicaciones',400),
      signedBy:actor.staffId,dispensedBy:null }
    this.#medications.set(rx.id,rx);this.#event(actor,'medication.prescribe',rx.id);return { ...rx }
  }
  /**
   * Operate the synthetic test-only step stock within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param sku - Validated sku input for this clinical operation.
   * @param quantity - Validated quantity input for this clinical operation.
   * @param unit - Validated unit input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  stock(actor: ClinicActor, sku: string, quantity: number, unit: string): InventoryRecord {
    this.#authorize(actor,'pharmacy')
    if(actor.role!=='pharmacist')throw new Error('Solo farmacia administra existencias.')
    if(!Number.isSafeInteger(quantity)||quantity<0)throw new TypeError('Cantidad inválida.')
    const key=checked(sku,'SKU',100);const current=this.#inventory.get(key)
    const item:InventoryRecord={ organization:this.organization,sku:key,quantity:(current?.quantity??0)+quantity,
      unit:checked(unit,'Unidad',60) }
    this.#inventory.set(key,item);this.#event(actor,'stock.receive',key);return { ...item }
  }
  /**
   * Operate the synthetic test-only step dispense within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param rxId - Validated rxId input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  dispense(actor: ClinicActor, rxId: string): MedicationRecord {
    this.#authorize(actor,'pharmacy')
    if(actor.role!=='pharmacist')throw new Error('La dispensación corresponde a farmacia.')
    const rx=this.#medications.get(rxId);if(!rx)throw new Error('Receta no encontrada.')
    if(rx.dispensedBy)throw new Error('Esta receta ya fue dispensada.')
    const item=this.#inventory.get(rx.medication)
    if(!item||item.quantity<1)throw new Error('Sin existencias; dispensación bloqueada.')
    item.quantity--;rx.dispensedBy=actor.staffId;this.#event(actor,'medication.dispense',rx.id);return { ...rx }
  }
  /**
   * Operate the synthetic test-only step invoice within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param patientId - Validated patientId input for this clinical operation.
   * @param description - Validated description input for this clinical operation.
   * @param amountCents - Validated amountCents input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  invoice(actor:ClinicActor,patientId:string,description:string,amountCents:number):InvoiceRecord {
    this.#authorize(actor,'billing');this.#patient(patientId)
    const item:InvoiceRecord={ id:this.#id('invoice'),organization:this.organization,patientId,
      description:checked(description,'Concepto',200),amount:money(amountCents),paid:0 }
    this.#invoices.set(item.id,item);this.#event(actor,'invoice.create',item.id);return { ...item }
  }
  /**
   * Operate the synthetic test-only step payment within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @param invoiceId - Validated invoiceId input for this clinical operation.
   * @param amountCents - Validated amountCents input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  payment(actor:ClinicActor,invoiceId:string,amountCents:number):InvoiceRecord {
    this.#authorize(actor,'billing')
    const inv=this.#invoices.get(invoiceId);if(!inv)throw new Error('Factura no encontrada.')
    const amount=money(amountCents);if(!amount||inv.paid+amount>inv.amount)throw new Error('Importe fuera del saldo de factura.')
    inv.paid+=amount;this.#event(actor,'invoice.payment',inv.id);return { ...inv }
  }
  /** Return copies so callers cannot mutate the audit trail or clinical records. */
  /**
   * Operate the synthetic test-only step snapshot within the isolated clinical workflow.
   * @param actor - Validated actor input for this clinical operation.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  snapshot(actor:ClinicActor):ClinicSnapshot {
    const actorInput: unknown = actor
    if(typeof actorInput!=='object'||actorInput===null)throw new Error('Acceso denegado.')
    if(actor.organization!==this.organization||!actor.staffId||
      !Object.values(ROLE_ACCESS).some(roles=>roles.includes(actor.role)))throw new Error('Acceso denegado.')
    const publicPatient=ROLE_ACCESS.patients.includes(actor.role)
    const clinical=ROLE_ACCESS.consultations.includes(actor.role)
    const laboratory=actor.role==='laboratory'||clinical
    const imaging=actor.role==='radiologist'||clinical
    const pharmacy=actor.role==='pharmacist'||actor.role==='clinician'
    const finance=actor.role==='billing'
    return {
      patients:publicPatient?[...this.#patients.values()].map(x=>({ ...x })):[],
      appointments:ROLE_ACCESS.appointments.includes(actor.role)?[...this.#appointments.values()].map(x=>({ ...x })):[],
      encounters:clinical?[...this.#encounters.values()].map(x=>({ ...x })):[],
      orders:[...this.#orders.values()].filter(x=>(x.kind==='laboratory'&&laboratory)||(x.kind==='imaging'&&imaging))
        .map(x=>({ ...x })),
      medications:pharmacy?[...this.#medications.values()].map(x=>({ ...x })):[],
      inventory:actor.role==='pharmacist'?[...this.#inventory.values()].map(x=>({ ...x })):[],
      invoices:finance?[...this.#invoices.values()].map(x=>({ ...x })):[],
      audit:[], // Audit logs belong to an authenticated compliance officer, not general staff.
    }
  }
  /** Synthetic-only audit export for test harness; never exposed through the model tool. */
  /**
   * Operate the synthetic test-only step auditForTests within the isolated clinical workflow.
   * @returns The operation result, restricted to this authorized clinical context.
   */
  auditForTests(): readonly ClinicAuditEvent[] { return this.#audit.map(x=>({ ...x })) }
}
