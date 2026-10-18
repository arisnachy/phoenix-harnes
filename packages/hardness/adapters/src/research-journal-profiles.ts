/**
 * Journal-specific manuscript admission hints from official instructions.
 * Not a claim of AMA 11th edition or peer-review compliance.
 */
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

export type JournalName = 'jama' | 'jama-network-open' | 'custom'
export type JournalArticle = 'original_investigation' | 'research_letter' | 'brief_report'
  | 'systematic_review' | 'narrative_review'
type Profile = {
  journal: string
  article_type: JournalArticle
  citation_style: 'ama' | null
  source_url: string | null
  manuscript_limits: { max_words: number | null; max_abstract_words: number | null;
    max_references: number | null; max_tables_figures: number | null }
  requires: string[]
  editorial_presentation: 'academic' | 'hybrid'
  compliant: false
  warnings: string[]
}
/**
 * Produce journal/document-type requirements with identifiable official source and caveats.
 * @param journal - target journal or custom publisher instructions.
 * @param article - the exact article category.
 * @returns limits that must be reconfirmed against the current journal instructions.
 */
export function journalPublicationProfile(journal: JournalName, article: JournalArticle): Profile {
  if (!['jama', 'jama-network-open', 'custom'].includes(journal)
    || !['original_investigation', 'research_letter', 'brief_report', 'systematic_review', 'narrative_review'].includes(article)) {
    throw new ToolArgsError(['Selecciona una revista y tipo de artículo admitidos.'])
  }
  const publishedUrl = journal === 'jama'
    ? 'https://jamanetwork.com/journals/jama/pages/instructions-for-authors/'
    : journal === 'jama-network-open'
      ? 'https://jamanetwork.com/journals/jamanetworkopen/pages/instructions-for-authors'
      : null
  let maxWords: number | null = null
  let maxAbstract: number | null = null
  let maxReferences: number | null = null
  let maxVisuals: number | null = null
  const required = ['autoría y afiliaciones', 'conflictos de interés', 'financiación', 'aprobación ética si procede']
  if (journal !== 'custom') {
    if (article === 'original_investigation') {
      maxWords = 3000; maxAbstract = 350; maxVisuals = 5
      required.push('abstract estructurado', 'Key Points', 'declaración de disponibilidad de datos')
    } else if (article === 'research_letter') {
      maxWords = 800; maxReferences = 10; maxVisuals = 2
      required.push('declaración de disponibilidad de datos')
    } else if (article === 'brief_report' && journal === 'jama-network-open') {
      maxWords = 1200; maxReferences = 15; maxVisuals = 3
      required.push('abstract estructurado', 'Key Points', 'declaración de disponibilidad de datos')
    } else if (article === 'systematic_review' && journal === 'jama') {
      maxWords = 3000; maxAbstract = 350; maxVisuals = 5
      required.push('búsqueda y selección de estudios reproducibles', 'PRISMA según diseño', 'Key Points')
    }
  }
  const warnings = [
    'Los límites de JAMA varían por categoría, suplemento y revista; comprueba la versión vigente en la página oficial.',
    'Este perfil es una lista de requisitos inicial, no una certificación del cumplimiento AMA/JAMA.',
    'La plantilla con figuras incrustadas puede ser una edición de lectura: JAMA solicita figuras individuales al remitir el manuscrito.',
  ]
  if (journal === 'custom') warnings.push('Carga el reglamento real del editor: no se han inventado límites para una revista desconocida.')
  if (maxWords === null) warnings.push('No se dispone de límites seguros para esta combinación; revisar las instrucciones editoriales.')
  return {
    journal, article_type: article, citation_style: journal === 'custom' ? null : 'ama',
    source_url: publishedUrl,
    manuscript_limits: {
      max_words: maxWords, max_abstract_words: maxAbstract,
      max_references: maxReferences, max_tables_figures: maxVisuals,
    },
    requires: required, editorial_presentation: 'academic', compliant: false, warnings,
  }
}
/**
 * Return draftable JAMA requirements without fabricating journal acceptance.
 * @returns native journal profile lookup tool.
 */
export function createResearchJournalTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_journal_profile',
    description: 'Determina una lista inicial de normas oficiales de JAMA o JAMA Network Open por categoría de artículo (Original Investigation, Research Letter, etc.). Es un PERFIL PRELIMINAR con URL oficial, no una certificación AMA ni validación de la edición vigente. Para otra revista usar custom y el extractor de su reglamento real. Separa estilo bibliográfico AMA de diseño de edición moderna para lectura.',
    parameters: {
      journal: { type: 'string', required: true, enum: ['jama', 'jama-network-open', 'custom'] },
      article_type: { type: 'string', required: true,
        enum: ['original_investigation', 'research_letter', 'brief_report', 'systematic_review', 'narrative_review'] },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text',
        text: 'Normas editoriales candidatas: ' + JSON.stringify(value) + '. Verificación editorial pendiente.',
      }] },
    async execute(args) {
      return journalPublicationProfile(args.journal as JournalName, args.article_type as JournalArticle)
    },
    presentCall() { return { card: 'generic', title: 'Requisitos de revista científica', kind: 'execute' } },
  })
}
