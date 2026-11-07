/**
 * Broad, offline-discoverable professional instrument DIRECTORY.
 * A record is a bibliographic pointer, NOT an approved digital administration.
 * Never infer a license, translation validation, normative population, cutoff,
 * licensed item text, or manual from being listed here.
 */
export type AssessmentArea = 'Neuropsicología' | 'Psicología' | 'Medicina' | 'Rehabilitación' | 'Universal'
export type DirectoryAccess = 'verify' | 'license'
export interface AssessmentDirectoryEntry {
  readonly id: string
  readonly title: string
  readonly area: AssessmentArea
  readonly domain: string
  readonly sourcePortal: string
  readonly publisher: string
  readonly access: DirectoryAccess
  readonly state: 'catalog-only'
  readonly version: 'Verificar versión oficial'
  readonly language: 'Confirmar adaptación autorizada'
}
type Group = {
  readonly area: AssessmentArea
  readonly domain: string
  readonly publisher: string
  readonly url: string
  readonly access: DirectoryAccess
  readonly names: readonly string[]
}
/** Curated names and source portals, not copyrighted test content. */
const groups: readonly Group[] = [
  {
    "area": "Neuropsicología",
    "domain": "Cribado cognitivo y demencias",
    "publisher": "National Institute on Aging",
    "url": "https://www.nia.nih.gov/health/assessing-cognitive-impairment-older-patients",
    "access": "verify",
    "names": [
      "ACE-III · Addenbrooke's Cognitive Examination",
      "ACE-R · Addenbrooke's Cognitive Examination Revised",
      "SLUMS · Saint Louis University Mental Status",
      "AD8 · Ascertain Dementia 8",
      "IQCODE · Informant Questionnaire on Cognitive Decline",
      "CDR · Clinical Dementia Rating",
      "GDS · Global Deterioration Scale",
      "FAST · Functional Assessment Staging",
      "ADAS-Cog · Alzheimer's Disease Assessment Scale",
      "Pfeffer FAQ · Functional Activities Questionnaire",
      "Clock Drawing Test · dibujo del reloj",
      "Frontal Assessment Battery · FAB",
      "6CIT · Six-item Cognitive Impairment Test"
    ]
  },
  {
    "area": "Neuropsicología",
    "domain": "Atención, velocidad y funciones ejecutivas",
    "publisher": "PAR / titulares de instrumentos",
    "url": "https://www.parinc.com/",
    "access": "verify",
    "names": [
      "Trail Making Test A/B · TMT",
      "Stroop Color and Word Test",
      "Wisconsin Card Sorting Test · WCST",
      "D-KEFS · Delis-Kaplan Executive Function System",
      "Symbol Digit Modalities Test · SDMT",
      "Continuous Performance Test · CPT",
      "Conners CPT 3",
      "Test of Variables of Attention · TOVA",
      "Color Trails Test",
      "Tower of London",
      "Hayling Sentence Completion Test",
      "Brixton Spatial Anticipation Test",
      "Behavior Rating Inventory of Executive Function · BRIEF-2",
      "Everyday Cognition · ECog"
    ]
  },
  {
    "area": "Neuropsicología",
    "domain": "Memoria y aprendizaje",
    "publisher": "PAR / titulares de instrumentos",
    "url": "https://www.parinc.com/",
    "access": "verify",
    "names": [
      "Rey Auditory Verbal Learning Test · RAVLT",
      "California Verbal Learning Test · CVLT-3",
      "Hopkins Verbal Learning Test Revised · HVLT-R",
      "Brief Visuospatial Memory Test Revised · BVMT-R",
      "Rivermead Behavioural Memory Test · RBMT-3",
      "Wechsler Memory Scale · WMS-IV",
      "Rey-Osterrieth Complex Figure Test · ROCF",
      "Benton Visual Retention Test · BVRT",
      "Doors and People Test",
      "Memory Assessment Scales · MAS"
    ]
  },
  {
    "area": "Neuropsicología",
    "domain": "Lenguaje, inteligencia y desarrollo cognitivo",
    "publisher": "Pearson / titulares de instrumentos",
    "url": "https://www.pearsonassessments.com/",
    "access": "license",
    "names": [
      "WAIS-IV · Wechsler Adult Intelligence Scale",
      "WISC-V · Wechsler Intelligence Scale for Children",
      "WPPSI-IV · Wechsler Preschool Intelligence Scale",
      "WASI-II · Wechsler Abbreviated Scale of Intelligence",
      "RBANS · Repeatable Battery for Assessment of Neuropsychological Status",
      "NEPSY-II · Developmental Neuropsychological Assessment",
      "Boston Naming Test · BNT",
      "Controlled Oral Word Association Test · COWAT",
      "Token Test",
      "Peabody Picture Vocabulary Test · PPVT-5",
      "Raven's Progressive Matrices",
      "Leiter-3 · Nonverbal Intelligence Test",
      "Woodcock-Johnson IV · Cognitive",
      "KABC-II · Kaufman Assessment Battery"
    ]
  },
  {
    "area": "Psicología",
    "domain": "Depresión, ansiedad y estrés",
    "publisher": "APA / titulares de instrumentos",
    "url": "https://www.apa.org/pi/about/publications/caregivers/practice-settings/assessment/tools",
    "access": "verify",
    "names": [
      "PHQ-2 · Patient Health Questionnaire",
      "GAD-2 · Generalized Anxiety Disorder",
      "BDI-II · Beck Depression Inventory",
      "BAI · Beck Anxiety Inventory",
      "DASS-21 · Depression Anxiety Stress Scales",
      "HAM-D · Hamilton Depression Rating Scale",
      "HAM-A · Hamilton Anxiety Rating Scale",
      "MADRS · Montgomery-Asberg Depression Rating Scale",
      "K10 · Kessler Psychological Distress",
      "HADS · Hospital Anxiety and Depression Scale",
      "CES-D · Center for Epidemiologic Studies Depression",
      "QIDS-SR · Quick Inventory of Depressive Symptomatology",
      "GDS-15 · Geriatric Depression Scale",
      "EPDS · Edinburgh Postnatal Depression Scale",
      "WHO-5 · Well-Being Index",
      "PSS-10 · Perceived Stress Scale",
      "SCARED · Screen for Child Anxiety"
    ]
  },
  {
    "area": "Psicología",
    "domain": "Trauma, riesgo y trastornos graves",
    "publisher": "U.S. National Center for PTSD / titulares",
    "url": "https://www.ptsd.va.gov/professional/assessment/",
    "access": "verify",
    "names": [
      "PCL-5 · PTSD Checklist for DSM-5",
      "CAPS-5 · Clinician-Administered PTSD Scale",
      "PC-PTSD-5 · Primary Care PTSD Screen",
      "C-SSRS · Columbia Suicide Severity Rating Scale",
      "BPRS · Brief Psychiatric Rating Scale",
      "PANSS · Positive and Negative Syndrome Scale",
      "YMRS · Young Mania Rating Scale",
      "MDQ · Mood Disorder Questionnaire",
      "OCI-R · Obsessive-Compulsive Inventory Revised",
      "Y-BOCS · Yale-Brown Obsessive Compulsive Scale",
      "SCL-90-R · Symptom Checklist",
      "Brief Symptom Inventory · BSI",
      "DES-II · Dissociative Experiences Scale"
    ]
  },
  {
    "area": "Psicología",
    "domain": "Personalidad, funcionamiento y calidad de vida",
    "publisher": "Pearson / titulares de instrumentos",
    "url": "https://www.pearsonassessments.com/",
    "access": "license",
    "names": [
      "MMPI-3 · Minnesota Multiphasic Personality Inventory",
      "MMPI-A-RF · Adolescent MMPI",
      "PAI · Personality Assessment Inventory",
      "MCMI-IV · Millon Clinical Multiaxial Inventory",
      "NEO PI-3 · Personality Inventory",
      "16PF · Sixteen Personality Factor Questionnaire",
      "WHOQOL-BREF · Quality of Life",
      "SWLS · Satisfaction With Life Scale",
      "SF-36 · 36-Item Short Form Health Survey",
      "SF-12 · 12-Item Short Form Health Survey",
      "WHODAS 2.0 · Disability Assessment Schedule"
    ]
  },
  {
    "area": "Psicología",
    "domain": "Neurodesarrollo, aprendizaje y conducta",
    "publisher": "Pearson / titulares de instrumentos",
    "url": "https://www.pearsonassessments.com/",
    "access": "verify",
    "names": [
      "ADOS-2 · Autism Diagnostic Observation Schedule",
      "ADI-R · Autism Diagnostic Interview Revised",
      "M-CHAT-R/F · Autism Screening",
      "SRS-2 · Social Responsiveness Scale",
      "Vineland-3 · Adaptive Behavior Scales",
      "ABAS-3 · Adaptive Behavior Assessment System",
      "Conners 4 · ADHD",
      "ADHD-RS-5 · ADHD Rating Scale",
      "Vanderbilt ADHD Rating Scales",
      "SNAP-IV · ADHD Symptoms",
      "ASRS v1.1 · Adult ADHD Self-Report Scale",
      "CBCL · Child Behavior Checklist",
      "BASC-3 · Behavior Assessment System",
      "SDQ · Strengths and Difficulties Questionnaire",
      "RCADS · Revised Child Anxiety and Depression Scale",
      "KIDSCREEN · Pediatric Quality of Life",
      "PedsQL · Pediatric Quality of Life Inventory"
    ]
  },
  {
    "area": "Psicología",
    "domain": "Sueño, consumo y conducta",
    "publisher": "WHO / titulares de instrumentos",
    "url": "https://www.who.int/",
    "access": "verify",
    "names": [
      "AUDIT · Alcohol Use Disorders Identification Test",
      "AUDIT-C · Brief Alcohol Screen",
      "DAST-10 · Drug Abuse Screening Test",
      "CAGE · Alcohol Screening",
      "ASSIST · Alcohol Smoking Substance Involvement Screening",
      "FTND · Fagerstrom Test for Nicotine Dependence",
      "PSQI · Pittsburgh Sleep Quality Index",
      "ISI · Insomnia Severity Index",
      "ESS · Epworth Sleepiness Scale",
      "STOP-Bang · Obstructive Sleep Apnea Screening",
      "ISI · Insomnia Severity Index (adaptación)"
    ]
  },
  {
    "area": "Medicina",
    "domain": "Urgencias y riesgo cardiovascular",
    "publisher": "AHA / sociedades clínicas",
    "url": "https://www.heart.org/",
    "access": "verify",
    "names": [
      "Glasgow Coma Scale · GCS",
      "NIH Stroke Scale · NIHSS",
      "Modified Rankin Scale · mRS",
      "HEART Score · Dolor torácico",
      "TIMI Risk Score",
      "GRACE Risk Score",
      "CHA2DS2-VASc · Riesgo de ictus",
      "HAS-BLED · Riesgo hemorrágico",
      "Wells Score · TVP",
      "Wells Score · Embolia pulmonar",
      "PERC · Pulmonary Embolism Rule-Out",
      "CURB-65 · Neumonía",
      "qSOFA · Infección y disfunción orgánica",
      "SOFA · Sequential Organ Failure Assessment",
      "NEWS2 · National Early Warning Score",
      "MEWS · Modified Early Warning Score",
      "APACHE II · Critical Care",
      "SAPS II · Severity Score"
    ]
  },
  {
    "area": "Medicina",
    "domain": "Atención primaria, crónicos y respiratorio",
    "publisher": "NICE / sociedades clínicas",
    "url": "https://www.nice.org.uk/",
    "access": "verify",
    "names": [
      "COPD Assessment Test · CAT",
      "mMRC · Disnea",
      "Asthma Control Test · ACT",
      "Asthma Control Questionnaire · ACQ",
      "Saint George Respiratory Questionnaire · SGRQ",
      "IPSS · International Prostate Symptom Score",
      "ICIQ-UI SF · Urinary Incontinence",
      "KDQOL-36 · Kidney Disease Quality of Life",
      "Charlson Comorbidity Index",
      "Clinical Frailty Scale · CFS",
      "FRAIL Scale · Fragilidad",
      "SARC-F · Sarcopenia",
      "MUST · Malnutrition Universal Screening Tool",
      "Mini Nutritional Assessment · MNA",
      "NRS-2002 · Nutritional Risk Screening",
      "ECOG Performance Status",
      "Karnofsky Performance Status"
    ]
  },
  {
    "area": "Medicina",
    "domain": "Enfermería, geriatría y hospitalización",
    "publisher": "AHRQ / autores de instrumentos",
    "url": "https://www.ahrq.gov/",
    "access": "verify",
    "names": [
      "Braden Scale · Riesgo úlceras por presión",
      "Morse Fall Scale · Riesgo caídas",
      "Hendrich II Fall Risk Model",
      "Katz ADL · Actividades básicas",
      "Lawton-Brody IADL · Actividades instrumentales",
      "Barthel Index · Actividades diarias",
      "Functional Independence Measure · FIM",
      "Confusion Assessment Method · CAM",
      "4AT · Delirium Assessment",
      "RASS · Richmond Agitation Sedation Scale",
      "CPOT · Critical-Care Pain Observation Tool",
      "FLACC · Pediatric Pain Assessment",
      "Numeric Rating Scale · Dolor",
      "Visual Analogue Scale · EVA",
      "Wong-Baker FACES Pain Scale"
    ]
  },
  {
    "area": "Medicina",
    "domain": "Obstetricia, neonatología y pediatría",
    "publisher": "WHO / autores de instrumentos",
    "url": "https://www.who.int/health-topics/maternal-health",
    "access": "verify",
    "names": [
      "APGAR · Valoración neonatal",
      "Bishop Score · Maduración cervical",
      "Ballard Score · Edad gestacional",
      "Silverman-Andersen · Dificultad respiratoria",
      "PEWS · Pediatric Early Warning Score",
      "Pediatric Glasgow Coma Scale",
      "Denver II · Desarrollo infantil",
      "ASQ-3 · Ages and Stages Questionnaire",
      "Bayley-4 · Scales of Infant Development",
      "Edinburgh Postnatal Depression Scale · EPDS",
      "CRIES · Neonatal Pain Scale"
    ]
  },
  {
    "area": "Rehabilitación",
    "domain": "Motricidad, funcionalidad y calidad de vida",
    "publisher": "Shirley Ryan AbilityLab RehabMeasures",
    "url": "https://www.sralab.org/rehabilitation-measures",
    "access": "verify",
    "names": [
      "Berg Balance Scale",
      "Timed Up and Go · TUG",
      "6-Minute Walk Test · 6MWT",
      "10-Meter Walk Test · 10MWT",
      "Fugl-Meyer Assessment",
      "Functional Gait Assessment · FGA",
      "Oswestry Disability Index · ODI",
      "Roland-Morris Disability Questionnaire",
      "KOOS · Knee Injury and Osteoarthritis Outcome Score",
      "HOOS · Hip Disability and Osteoarthritis Outcome Score",
      "WOMAC · Osteoarthritis Index",
      "Oxford Hip Score",
      "DASH · Disabilities of Arm Shoulder and Hand",
      "QuickDASH",
      "LEFS · Lower Extremity Functional Scale",
      "FIM · Functional Independence Measure"
    ]
  },
  {
    "area": "Medicina",
    "domain": "Medidas reportadas y calidad de vida",
    "publisher": "HealthMeasures / otros titulares",
    "url": "https://www.healthmeasures.net/",
    "access": "verify",
    "names": [
      "PROMIS-29 · Profile",
      "PROMIS Global Health",
      "PROMIS Depression Item Bank",
      "PROMIS Anxiety Item Bank",
      "PROMIS Fatigue",
      "PROMIS Pain Interference",
      "PROMIS Physical Function",
      "Neuro-QoL Cognitive Function",
      "Neuro-QoL Fatigue",
      "NIH Toolbox Cognition Battery",
      "EQ-5D-5L · EuroQol",
      "EORTC QLQ-C30 · Oncology Quality of Life",
      "FACIT-F · Fatigue",
      "PROMIS Pediatric Profile"
    ]
  },
  {
    "area": "Universal",
    "domain": "Trabajo, educación y negocios",
    "publisher": "ISO / titulares / organización usuaria",
    "url": "https://www.iso.org/",
    "access": "verify",
    "names": [
      "Encuesta de clima laboral · Instrumento propio",
      "Evaluación 360° · Instrumento organizacional",
      "Índice de satisfacción del cliente · CSAT",
      "Net Promoter Score · NPS",
      "System Usability Scale · SUS",
      "NASA-TLX · Task Load Index",
      "Maslach Burnout Inventory · MBI",
      "Utrecht Work Engagement Scale · UWES",
      "Copenhagen Psychosocial Questionnaire · COPSOQ",
      "Cuestionario de desempeño académico · Instrumento propio",
      "Evaluación de competencias · Rubrica propia",
      "Escala Likert de satisfacción · Instrumento propio"
    ]
  }
] as const
const idFor = (name: string): string => name
  .normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
  .replace(/[^a-z0-9]+/gu,'-').replace(/^-|-$/gu,'')
export const assessmentDirectory: readonly AssessmentDirectoryEntry[] = groups.flatMap((group) =>
  group.names.map((title) => ({
    id: group.area.toLowerCase() + '-' + idFor(title),
    title, area: group.area, domain: group.domain,
    sourcePortal: group.url, publisher: group.publisher,
    access: group.access, state: 'catalog-only' as const,
    version: 'Verificar versión oficial' as const,
    language: 'Confirmar adaptación autorizada' as const,
  })))
const index = new Set(assessmentDirectory.map((entry) => entry.id))
if(index.size !== assessmentDirectory.length) {
  throw new Error('Duplicate professional assessment identifiers')
}
/** Search locally, preserving all names even if the exact version is not licensed. */
export function searchAssessmentDirectory(
  query: string, area?: AssessmentArea,
): AssessmentDirectoryEntry[] {
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim()
  return assessmentDirectory.filter((item) => {
    if(area && item.area !== area) return false
    if(!normalized) return true
    const search = [item.title,item.domain,item.area,item.publisher].join(' ')
      .normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
    return search.includes(normalized)
  })
}
