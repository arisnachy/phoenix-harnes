/** Public-source catalog: metadata and eligibility only, never a promise of API health or full-text access. */
import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

export interface ResearchCatalogEntry {
  readonly id: string
  readonly name: string
  readonly discipline: string
  readonly url: string
  readonly access: string
  readonly priority: string
  readonly purpose: string
  readonly notes: string
  readonly productionVerified: boolean
}

/** Source descriptions are curated; no network request is made merely by listing them. */
export const RESEARCH_API_CATALOG: readonly ResearchCatalogEntry[] = [
  {
    "id": "openalex",
    "name": "OpenAlex",
    "discipline": "Bibliografía",
    "url": "https://api.openalex.org/works",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Publicaciones, grafo bibliográfico, autores, temas y citas",
    "notes": "Sin clave para búsquedas básicas; cursor profundo exige clave gratuita",
    "productionVerified": false
  },
  {
    "id": "crossref",
    "name": "Crossref",
    "discipline": "Bibliografía",
    "url": "https://api.crossref.org/works",
    "access": "none",
    "priority": "P0",
    "purpose": "DOI, bibliografía, editorial, revistas y actualizaciones",
    "notes": "Pool público limitado; usar mailto/agent para polite",
    "productionVerified": false
  },
  {
    "id": "semantic-scholar",
    "name": "Semantic Scholar",
    "discipline": "Bibliografía",
    "url": "https://api.semanticscholar.org/graph/v1/paper/search",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Descubrimiento científico y red de citas",
    "notes": "Cuota anónima global compartida; algunas operaciones exigen clave",
    "productionVerified": false
  },
  {
    "id": "openaire-graph-v4",
    "name": "OpenAIRE Graph v4",
    "discipline": "Bibliografía",
    "url": "https://api.openaire.eu/graph/v4/research-products",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Publicaciones, software, datasets y proyectos financiados",
    "notes": "Consultar políticas de tráfico y filtrado",
    "productionVerified": false
  },
  {
    "id": "datacite",
    "name": "DataCite",
    "discipline": "Bibliografía",
    "url": "https://api.datacite.org/dois",
    "access": "none",
    "priority": "P0",
    "purpose": "DOI de datos, software y otros resultados de investigación",
    "notes": "Metadatos; no implica acceso al contenido",
    "productionVerified": false
  },
  {
    "id": "opencitations",
    "name": "OpenCitations",
    "discipline": "Bibliografía",
    "url": "https://api.opencitations.net/index/v2",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Citas abiertas y relaciones bibliográficas",
    "notes": "Token opcional para mayor capacidad",
    "productionVerified": false
  },
  {
    "id": "doaj",
    "name": "DOAJ",
    "discipline": "Bibliografía",
    "url": "https://doaj.org/api/search/articles/",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Artículos y revistas de acceso abierto",
    "notes": "Validar cobertura, tipos de licencia y ruta vigente",
    "productionVerified": false
  },
  {
    "id": "dblp",
    "name": "DBLP",
    "discipline": "Bibliografía",
    "url": "https://dblp.org/search/publ/api",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Informática, autores, congresos y bibliografía",
    "notes": "No es repositorio de texto completo",
    "productionVerified": false
  },
  {
    "id": "arxiv",
    "name": "arXiv",
    "discipline": "Bibliografía",
    "url": "https://export.arxiv.org/api/query",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Preprints de física, matemáticas, computación y estadística",
    "notes": "Separar solicitudes >= 3 segundos",
    "productionVerified": false
  },
  {
    "id": "europe-pmc",
    "name": "Europe PMC",
    "discipline": "Bibliografía",
    "url": "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
    "access": "none",
    "priority": "P0",
    "purpose": "Literatura biomédica, citas, abstracs y texto completo abierto",
    "notes": "Distinguir publicaciones y preprints",
    "productionVerified": false
  },
  {
    "id": "ncbi-pubmed",
    "name": "NCBI PubMed",
    "discipline": "Bibliografía",
    "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Medicina, salud pública, artículos y tesauro MeSH",
    "notes": "3 solicitudes/segundo por IP sin clave",
    "productionVerified": false
  },
  {
    "id": "nih-pubmed-central-oai-pmh",
    "name": "NIH PubMed Central OAI-PMH",
    "discipline": "Repositorios",
    "url": "https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/",
    "access": "none",
    "priority": "P0",
    "purpose": "Metadatos y texto de subconjunto legalmente reutilizable",
    "notes": "El resto de PMC puede tener restricciones de licencia",
    "productionVerified": false
  },
  {
    "id": "pmc-bioc",
    "name": "PMC BioC",
    "discipline": "Repositorios",
    "url": "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi",
    "access": "none",
    "priority": "P0",
    "purpose": "Texto completo de PMC Open Access en BioC JSON/XML",
    "notes": "Solo subconjunto permitido por licencia",
    "productionVerified": false
  },
  {
    "id": "bioc-pubmed",
    "name": "BioC PubMed",
    "discipline": "Repositorios",
    "url": "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi",
    "access": "none",
    "priority": "P1",
    "purpose": "Text mining de abstracts y metadatos PubMed",
    "notes": "No confundir con texto completo",
    "productionVerified": false
  },
  {
    "id": "biorxiv",
    "name": "bioRxiv",
    "discipline": "Repositorios",
    "url": "https://api.biorxiv.org/details/biorxiv/",
    "access": "none",
    "priority": "P1",
    "purpose": "Preprints de biología y versiones",
    "notes": "Preprint no revisado por pares",
    "productionVerified": false
  },
  {
    "id": "medrxiv",
    "name": "medRxiv",
    "discipline": "Repositorios",
    "url": "https://api.biorxiv.org/details/medrxiv/",
    "access": "none",
    "priority": "P1",
    "purpose": "Preprints de medicina",
    "notes": "No usar como evidencia clínica establecida",
    "productionVerified": false
  },
  {
    "id": "hal",
    "name": "HAL",
    "discipline": "Repositorios",
    "url": "https://api.archives-ouvertes.fr/search/",
    "access": "none",
    "priority": "P1",
    "purpose": "Repositorio académico multidisciplinario europeo",
    "notes": "Cobertura por depósitos",
    "productionVerified": false
  },
  {
    "id": "zenodo",
    "name": "Zenodo",
    "discipline": "Repositorios",
    "url": "https://zenodo.org/api/records",
    "access": "none",
    "priority": "P1",
    "purpose": "Datasets, informes, preprints, software y resultados DOI",
    "notes": "Verificar archivos y licencia",
    "productionVerified": false
  },
  {
    "id": "figshare",
    "name": "Figshare",
    "discipline": "Repositorios",
    "url": "https://api.figshare.com/v2/articles",
    "access": "none",
    "priority": "P1",
    "purpose": "Datos y materiales asociados a investigaciones",
    "notes": "Metadatos y licencias por recurso",
    "productionVerified": false
  },
  {
    "id": "open-science-framework",
    "name": "Open Science Framework",
    "discipline": "Repositorios",
    "url": "https://api.osf.io/v2/nodes/",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Prerregistros, proyectos y preprints públicos",
    "notes": "Solo recursos públicos; algunos métodos requieren token",
    "productionVerified": false
  },
  {
    "id": "plos-search",
    "name": "PLOS Search",
    "discipline": "Repositorios",
    "url": "https://api.plos.org/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Artículos de revistas PLOS",
    "notes": "Cobertura limitada a PLOS",
    "productionVerified": false
  },
  {
    "id": "scielo-articlemeta",
    "name": "SciELO ArticleMeta",
    "discipline": "Repositorios",
    "url": "https://articlemeta.scielo.org/",
    "access": "needs_validation",
    "priority": "P1",
    "purpose": "Literatura latinoamericana en español y portugués",
    "notes": "Confirmar operaciones disponibles en cada despliegue",
    "productionVerified": false
  },
  {
    "id": "internet-archive-advanced-search",
    "name": "Internet Archive Advanced Search",
    "discipline": "Repositorios",
    "url": "https://archive.org/advancedsearch.php",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Libros, colecciones y documentos digitales",
    "notes": "Los derechos de acceso varían",
    "productionVerified": false
  },
  {
    "id": "ror-registry",
    "name": "ROR Registry",
    "discipline": "Identificadores",
    "url": "https://api.ror.org/v2/organizations",
    "access": "none",
    "priority": "P1",
    "purpose": "Identidad fiable de universidades y organismos",
    "notes": "Cupo 2.000 solicitudes/5 minutos según documentación",
    "productionVerified": false
  },
  {
    "id": "unpaywall-doi",
    "name": "Unpaywall DOI",
    "discipline": "Identificadores",
    "url": "https://api.unpaywall.org/v2/",
    "access": "email_required",
    "priority": "P1",
    "purpose": "Localiza copias legítimas de acceso abierto por DOI",
    "notes": "Correo electrónico real obligatorio; sin búsqueda libre por texto",
    "productionVerified": false
  },
  {
    "id": "wikidata-sparql",
    "name": "Wikidata SPARQL",
    "discipline": "Identificadores",
    "url": "https://query.wikidata.org/sparql",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Entidades, relaciones e identificadores universales",
    "notes": "No es evidencia científica primaria; migración backend 2026-27",
    "productionVerified": false
  },
  {
    "id": "clinicaltrials-gov-v2",
    "name": "ClinicalTrials.gov v2",
    "discipline": "Biomedicina",
    "url": "https://clinicaltrials.gov/api/v2/studies",
    "access": "none",
    "priority": "P0",
    "purpose": "Registros y resultados de ensayos clínicos",
    "notes": "Registro no equivale a eficacia demostrada",
    "productionVerified": false
  },
  {
    "id": "nih-icite",
    "name": "NIH iCite",
    "discipline": "Biomedicina",
    "url": "https://icite.od.nih.gov/api/pubs",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Bibliometría científica y citación relativa",
    "notes": "No sustituye evaluación metodológica",
    "productionVerified": false
  },
  {
    "id": "openfda",
    "name": "openFDA",
    "discipline": "Biomedicina",
    "url": "https://api.fda.gov/drug/event.json",
    "access": "conditional_docs",
    "priority": "P1",
    "purpose": "Eventos adversos, etiquetado y dispositivos regulados",
    "notes": "Documentación contradictoria: indica clave requerida pero publica cuota anónima",
    "productionVerified": false
  },
  {
    "id": "pubchem-pug-rest",
    "name": "PubChem PUG REST",
    "discipline": "Biomedicina",
    "url": "https://pubchem.ncbi.nlm.nih.gov/rest/pug",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Química, sustancias, bioactividad y propiedades",
    "notes": "No superar 5 solicitudes/segundo por IP",
    "productionVerified": false
  },
  {
    "id": "chembl",
    "name": "ChEMBL",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/chembl/api/data",
    "access": "none",
    "priority": "P1",
    "purpose": "Bioactividad farmacológica y ensayos químicos",
    "notes": "Datos heterogéneos, normalizar unidades",
    "productionVerified": false
  },
  {
    "id": "chebi",
    "name": "ChEBI",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/chebi/backend/api/public",
    "access": "none",
    "priority": "P1",
    "purpose": "Entidades químicas y ontologías",
    "notes": "Confirmar ruta por versión",
    "productionVerified": false
  },
  {
    "id": "uniprot",
    "name": "UniProt",
    "discipline": "Biomedicina",
    "url": "https://rest.uniprot.org/uniprotkb/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Proteínas, anotaciones y literatura vinculada",
    "notes": "Diferenciar anotación revisada vs automática",
    "productionVerified": false
  },
  {
    "id": "ensembl",
    "name": "Ensembl",
    "discipline": "Biomedicina",
    "url": "https://rest.ensembl.org",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Genes, variantes y genomas",
    "notes": "Cupo por IP y especies",
    "productionVerified": false
  },
  {
    "id": "rcsb-pdb-search",
    "name": "RCSB PDB Search",
    "discipline": "Biomedicina",
    "url": "https://search.rcsb.org/rcsbsearch/v2/query",
    "access": "none",
    "priority": "P1",
    "purpose": "Búsqueda de estructuras biomoleculares",
    "notes": "POST con JSON estructurado",
    "productionVerified": false
  },
  {
    "id": "rcsb-pdb-data",
    "name": "RCSB PDB Data",
    "discipline": "Biomedicina",
    "url": "https://data.rcsb.org/graphql",
    "access": "none",
    "priority": "P1",
    "purpose": "Detalles estructurales PDB",
    "notes": "GraphQL POST, comprobar errors[] aunque HTTP 200",
    "productionVerified": false
  },
  {
    "id": "reactome",
    "name": "Reactome",
    "discipline": "Biomedicina",
    "url": "https://reactome.org/ContentService",
    "access": "none",
    "priority": "P1",
    "purpose": "Rutas de señalización y metabolismo",
    "notes": "Cambios de release afectan interpretaciones",
    "productionVerified": false
  },
  {
    "id": "gwas-catalog-rest-v2",
    "name": "GWAS Catalog REST v2",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/gwas/rest/api/v2",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Asociación genómica, variantes y fenotipos",
    "notes": "Solo v2; v1 retirada agosto 2026; 100 req/min, 15 req/s",
    "productionVerified": false
  },
  {
    "id": "open-targets",
    "name": "Open Targets",
    "discipline": "Biomedicina",
    "url": "https://api.platform.opentargets.org/api/v4/graphql",
    "access": "none",
    "priority": "P1",
    "purpose": "Dianas terapéuticas, enfermedades, fármacos y variantes",
    "notes": "GraphQL; registrar release y no confundir score con causalidad",
    "productionVerified": false
  },
  {
    "id": "ebi-ena",
    "name": "EBI ENA",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/ena/portal/api/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Secuencias y datos genómicos",
    "notes": "Usar filtros result correctos",
    "productionVerified": false
  },
  {
    "id": "ebi-ontology-lookup-ols4",
    "name": "EBI Ontology Lookup OLS4",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/ols4/api/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Vocabularios biomédicos y ontologías",
    "notes": "Resolver sinónimos y relaciones",
    "productionVerified": false
  },
  {
    "id": "ebi-search",
    "name": "EBI Search",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/ebisearch/ws/rest",
    "access": "none",
    "priority": "P2",
    "purpose": "Búsqueda federada de recursos EMBL-EBI",
    "notes": "Verificar dominios/colecciones",
    "productionVerified": false
  },
  {
    "id": "interpro",
    "name": "InterPro",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/interpro/api/entry/interpro/",
    "access": "none",
    "priority": "P1",
    "purpose": "Familias y dominios de proteínas",
    "notes": "Paginación",
    "productionVerified": false
  },
  {
    "id": "quickgo",
    "name": "QuickGO",
    "discipline": "Biomedicina",
    "url": "https://www.ebi.ac.uk/QuickGO/services/ontology/go/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Gene Ontology y anotaciones funcionales",
    "notes": "Interpretar evidencia experimental vs inferida",
    "productionVerified": false
  },
  {
    "id": "ncbi-gene",
    "name": "NCBI Gene",
    "discipline": "Biomedicina",
    "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Identificadores y anotaciones genéticas",
    "notes": "Comparte límite NCBI",
    "productionVerified": false
  },
  {
    "id": "ncbi-clinvar",
    "name": "NCBI ClinVar",
    "discipline": "Biomedicina",
    "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Variantes y significancia clínica",
    "notes": "Conflictos entre submitters deben reflejarse",
    "productionVerified": false
  },
  {
    "id": "ncbi-geo",
    "name": "NCBI GEO",
    "discipline": "Biomedicina",
    "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Expresión génica y experimentos ómicos",
    "notes": "Diferenciar depósito y revisión de calidad",
    "productionVerified": false
  },
  {
    "id": "medlineplus-connect",
    "name": "MedlinePlus Connect",
    "discipline": "Biomedicina",
    "url": "https://connect.medlineplus.gov/service",
    "access": "none",
    "priority": "P2",
    "purpose": "Información sanitaria ligada a códigos",
    "notes": "Información educativa, no guía clínica individual",
    "productionVerified": false
  },
  {
    "id": "dailymed-spl-api",
    "name": "DailyMed SPL API",
    "discipline": "Biomedicina",
    "url": "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json",
    "access": "none",
    "priority": "P1",
    "purpose": "Etiquetado farmacológico oficial estadounidense",
    "notes": "Verificar versión del medicamento y jurisdicción",
    "productionVerified": false
  },
  {
    "id": "world-bank-indicators",
    "name": "World Bank Indicators",
    "discipline": "Estadística y políticas",
    "url": "https://api.worldbank.org/v2",
    "access": "none",
    "priority": "P0",
    "purpose": "Indicadores económicos, sociales, educativos y sanitarios",
    "notes": "Sin API key; revisar año, país y fuente del indicador",
    "productionVerified": false
  },
  {
    "id": "who-global-health-observatory",
    "name": "WHO Global Health Observatory",
    "discipline": "Estadística y políticas",
    "url": "https://ghoapi.azureedge.net/api/Indicator",
    "access": "none",
    "priority": "P0",
    "purpose": "Indicadores mundiales de salud",
    "notes": "Interpretar definiciones y estimaciones",
    "productionVerified": false
  },
  {
    "id": "oecd-sdmx",
    "name": "OECD SDMX",
    "discipline": "Estadística y políticas",
    "url": "https://sdmx.oecd.org/public/rest/v1",
    "access": "none_limited",
    "priority": "P0",
    "purpose": "Economía, empleo, educación, salud y política pública",
    "notes": "Límites de solicitudes y dimensiones SDMX",
    "productionVerified": false
  },
  {
    "id": "eurostat-rest",
    "name": "Eurostat REST",
    "discipline": "Estadística y políticas",
    "url": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data",
    "access": "none",
    "priority": "P0",
    "purpose": "Estadística europea oficial",
    "notes": "JSON-stat, SDMX; no hay historial de versiones",
    "productionVerified": false
  },
  {
    "id": "imf-sdmx",
    "name": "IMF SDMX",
    "discipline": "Estadística y políticas",
    "url": "https://api.imf.org/external/sdmx/3.0",
    "access": "needs_validation",
    "priority": "P1",
    "purpose": "Moneda, cuentas, balanza y macroeconomía",
    "notes": "Verificar raíz vigente y acceso público en la nueva plataforma",
    "productionVerified": false
  },
  {
    "id": "us-census-api",
    "name": "US Census API",
    "discipline": "Estadística y políticas",
    "url": "https://api.census.gov/data",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Población, educación, vivienda y demografía EEUU",
    "notes": "500 solicitudes/día/IP sin clave",
    "productionVerified": false
  },
  {
    "id": "cdc-open-data-socrata",
    "name": "CDC Open Data Socrata",
    "discipline": "Estadística y políticas",
    "url": "https://data.cdc.gov",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Vigilancia y datos de salud pública",
    "notes": "Cada dataset tiene un id; token opcional aumenta cuota",
    "productionVerified": false
  },
  {
    "id": "uk-national-data-library-ckan",
    "name": "UK National Data Library CKAN",
    "discipline": "Estadística y políticas",
    "url": "https://data.gov.uk/api/action/package_search",
    "access": "none",
    "priority": "P1",
    "purpose": "Catálogo de datos oficiales del Reino Unido",
    "notes": "Devuelve datasets, no siempre datos descargados",
    "productionVerified": false
  },
  {
    "id": "datos-abiertos-republica-dominicana-ckan",
    "name": "Datos Abiertos República Dominicana CKAN",
    "discipline": "Estadística y políticas",
    "url": "https://datos.gob.do/api/3/action/package_search",
    "access": "none_expected",
    "priority": "P0",
    "purpose": "Catálogo de datos gubernamentales dominicanos",
    "notes": "Confirmar estabilidad/actualización de cada recurso",
    "productionVerified": false
  },
  {
    "id": "un-comtrade-preview",
    "name": "UN Comtrade Preview",
    "discipline": "Estadística y políticas",
    "url": "https://comtradeapi.un.org/public/v1/preview",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Comercio internacional y estadísticas por producto",
    "notes": "Preview hasta 500 registros; extracciones completas requieren clave",
    "productionVerified": false
  },
  {
    "id": "unhcr-refugee-data-api",
    "name": "UNHCR Refugee Data API",
    "discipline": "Estadística y políticas",
    "url": "https://api.unhcr.org/population/v1/",
    "access": "none_expected",
    "priority": "P1",
    "purpose": "Refugiados y desplazamiento poblacional",
    "notes": "Verificar política y esquema actuales",
    "productionVerified": false
  },
  {
    "id": "sec-edgar-api",
    "name": "SEC EDGAR API",
    "discipline": "Estadística y políticas",
    "url": "https://data.sec.gov",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Estados financieros XBRL y reportes corporativos",
    "notes": "User-Agent e identificación y respeto a Fair Access",
    "productionVerified": false
  },
  {
    "id": "us-data-gov-ckan",
    "name": "US Data.gov CKAN",
    "discipline": "Estadística y políticas",
    "url": "https://catalog.data.gov/api/3/action/package_search",
    "access": "none_expected",
    "priority": "P1",
    "purpose": "Catálogo de datasets gubernamentales estadounidenses",
    "notes": "Catálogo CKAN, recursos heterogéneos",
    "productionVerified": false
  },
  {
    "id": "faostat",
    "name": "FAOSTAT",
    "discipline": "Estadística y políticas",
    "url": "https://fenixservices.fao.org/faostat/api/v1/en",
    "access": "needs_validation",
    "priority": "P1",
    "purpose": "Agricultura, alimentos y seguridad alimentaria",
    "notes": "Verificar vigencia de endpoint y acceso antes de producción",
    "productionVerified": false
  },
  {
    "id": "ilostat-sdmx",
    "name": "ILOSTAT SDMX",
    "discipline": "Estadística y políticas",
    "url": "https://ilostat.ilo.org/data/",
    "access": "needs_validation",
    "priority": "P1",
    "purpose": "Trabajo, salarios, ocupación y empleo",
    "notes": "Verificar servicio SDMX y endpoints vigentes",
    "productionVerified": false
  },
  {
    "id": "usgs-earthquakes-fdsn",
    "name": "USGS Earthquakes FDSN",
    "discipline": "Geociencias y ambiente",
    "url": "https://earthquake.usgs.gov/fdsnws/event/1/query",
    "access": "none",
    "priority": "P1",
    "purpose": "Sismos, magnitud y localización",
    "notes": "Para tiempo real preferir feeds GeoJSON",
    "productionVerified": false
  },
  {
    "id": "usgs-water-data",
    "name": "USGS Water Data",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.waterdata.usgs.gov/",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Caudales, agua y estaciones hidrológicas",
    "notes": "No usar servicio heredado: cierre 22 febrero 2027",
    "productionVerified": false
  },
  {
    "id": "noaa-national-weather-service",
    "name": "NOAA National Weather Service",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.weather.gov",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Pronósticos, observaciones y alertas EEUU",
    "notes": "User-Agent obligatorio/recomendado y límites por uso razonable",
    "productionVerified": false
  },
  {
    "id": "noaa-tides-and-currents",
    "name": "NOAA Tides and Currents",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
    "access": "none",
    "priority": "P1",
    "purpose": "Mareas, nivel mar, corrientes y estaciones",
    "notes": "Limitar período solicitado",
    "productionVerified": false
  },
  {
    "id": "gbif",
    "name": "GBIF",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.gbif.org/v1/occurrence/search",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Biodiversidad, especies y ocurrencias",
    "notes": "Descargas masivas autenticadas; GET público",
    "productionVerified": false
  },
  {
    "id": "inaturalist",
    "name": "INaturalist",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.inaturalist.org/v1/observations",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Observaciones de especies y ciencia ciudadana",
    "notes": "Datos observacionales pueden requerir validación de identificación",
    "productionVerified": false
  },
  {
    "id": "nasa-ntrs",
    "name": "NASA NTRS",
    "discipline": "Geociencias y ambiente",
    "url": "https://ntrs.nasa.gov/api/citations/search",
    "access": "none",
    "priority": "P1",
    "purpose": "Reportes de ingeniería y ciencia aeroespacial",
    "notes": "Texto sujeto a disponibilidad y licencia",
    "productionVerified": false
  },
  {
    "id": "nasa-osdr",
    "name": "NASA OSDR",
    "discipline": "Geociencias y ambiente",
    "url": "https://osdr.nasa.gov/osdr/data/osd/meta/",
    "access": "none_expected",
    "priority": "P2",
    "purpose": "Experimentos científicos espaciales",
    "notes": "Verificar API versión y campos",
    "productionVerified": false
  },
  {
    "id": "open-meteo",
    "name": "Open-Meteo",
    "discipline": "Geociencias y ambiente",
    "url": "https://api.open-meteo.com/v1/forecast",
    "access": "none_noncommercial",
    "priority": "P2",
    "purpose": "Datos meteorológicos y pronóstico",
    "notes": "Plan sin clave solo para uso no comercial con condiciones",
    "productionVerified": false
  },
  {
    "id": "openstreetmap-overpass",
    "name": "OpenStreetMap Overpass",
    "discipline": "Geociencias y ambiente",
    "url": "https://overpass-api.de/api/interpreter",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Objetos geográficos OSM",
    "notes": "Respeto a límites públicos; no usar búsquedas pesadas por defecto",
    "productionVerified": false
  },
  {
    "id": "openstreetmap-nominatim",
    "name": "OpenStreetMap Nominatim",
    "discipline": "Geociencias y ambiente",
    "url": "https://nominatim.openstreetmap.org/search",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Geocodificación y nombres de lugares",
    "notes": "Servidor público máximo 1 solicitud/segundo; cachear",
    "productionVerified": false
  },
  {
    "id": "federal-register-api",
    "name": "Federal Register API",
    "discipline": "Derecho y regulación",
    "url": "https://www.federalregister.gov/api/v1/documents.json",
    "access": "none",
    "priority": "P1",
    "purpose": "Normas, propuestas y avisos federales de EEUU",
    "notes": "Verificar contra edición oficial para efectos jurídicos",
    "productionVerified": false
  },
  {
    "id": "uk-legislation-api",
    "name": "UK Legislation API",
    "discipline": "Derecho y regulación",
    "url": "https://www.legislation.gov.uk/openapi",
    "access": "none",
    "priority": "P1",
    "purpose": "Leyes británicas, cambios y notas",
    "notes": "Verificar entrada en vigor y jurisdicción",
    "productionVerified": false
  },
  {
    "id": "eu-publications-office-cellar-sparql",
    "name": "EU Publications Office CELLAR SPARQL",
    "discipline": "Derecho y regulación",
    "url": "https://publications.europa.eu/webapi/rdf/sparql",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Normativa de UE y relaciones jurídicas",
    "notes": "Consultas SPARQL; validación de cambios y textos oficiales",
    "productionVerified": false
  },
  {
    "id": "ecfr-developer-api",
    "name": "ECFR Developer API",
    "discipline": "Derecho y regulación",
    "url": "https://www.ecfr.gov/developers/documentation/api/v1",
    "access": "none_expected",
    "priority": "P1",
    "purpose": "Código de regulaciones federales estadounidenses",
    "notes": "Comprobar versiones de texto y vigencia",
    "productionVerified": false
  },
  {
    "id": "github-rest-public",
    "name": "GitHub REST Public",
    "discipline": "Software y tecnología",
    "url": "https://api.github.com/search/repositories",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Repositorios públicos, proyectos de software",
    "notes": "Bajo límite anónimo de búsqueda; no evalúa calidad automáticamente",
    "productionVerified": false
  },
  {
    "id": "hugging-face-hub-public",
    "name": "Hugging Face Hub Public",
    "discipline": "Software y tecnología",
    "url": "https://huggingface.co/api/models",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "Modelos y datasets de IA de libre acceso",
    "notes": "Model cards y licencias; no equivale a calidad de investigación",
    "productionVerified": false
  },
  {
    "id": "pypi-json-api",
    "name": "PyPI JSON API",
    "discipline": "Software y tecnología",
    "url": "https://pypi.org/pypi/requests/json",
    "access": "none",
    "priority": "P1",
    "purpose": "Metadatos y versiones de paquetes Python",
    "notes": "No usar versión nueva como evidencia de seguridad",
    "productionVerified": false
  },
  {
    "id": "npm-registry",
    "name": "npm Registry",
    "discipline": "Software y tecnología",
    "url": "https://registry.npmjs.org/react",
    "access": "none",
    "priority": "P1",
    "purpose": "Paquetes JavaScript",
    "notes": "Datos de editor, dependencias y versiones",
    "productionVerified": false
  },
  {
    "id": "crates-io-api",
    "name": "Crates.io API",
    "discipline": "Software y tecnología",
    "url": "https://crates.io/api/v1/crates",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Ecosistema Rust",
    "notes": "Incluir User-Agent y respetar política de uso",
    "productionVerified": false
  },
  {
    "id": "osv-dev-api",
    "name": "OSV.dev API",
    "discipline": "Software y tecnología",
    "url": "https://api.osv.dev/v1/query",
    "access": "none",
    "priority": "P1",
    "purpose": "Vulnerabilidades de dependencias open source",
    "notes": "Consulta principalmente por paquete/versión/commit",
    "productionVerified": false
  },
  {
    "id": "nist-nvd-cve-api",
    "name": "NIST NVD CVE API",
    "discipline": "Software y tecnología",
    "url": "https://services.nvd.nist.gov/rest/json/cves/2.0",
    "access": "none_limited",
    "priority": "P1",
    "purpose": "CVE y evaluación de vulnerabilidades",
    "notes": "Límites anónimos estrictos; programar cache incremental",
    "productionVerified": false
  },
  {
    "id": "stack-exchange-api",
    "name": "Stack Exchange API",
    "discipline": "Software y tecnología",
    "url": "https://api.stackexchange.com/2.3/search/advanced",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Problemas técnicos y soluciones comunitarias",
    "notes": "No es fuente científica revisada por pares",
    "productionVerified": false
  },
  {
    "id": "open-library-search",
    "name": "Open Library Search",
    "discipline": "Humanidades y cultura",
    "url": "https://openlibrary.org/search.json",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Libros, ediciones y autores",
    "notes": "Catalogación de origen mixto",
    "productionVerified": false
  },
  {
    "id": "library-of-congress-json",
    "name": "Library of Congress JSON",
    "discipline": "Humanidades y cultura",
    "url": "https://www.loc.gov/books/?fo=json",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Colecciones históricas, libros y documentos",
    "notes": "No implica permiso de redistribución",
    "productionVerified": false
  },
  {
    "id": "the-met-collection-api",
    "name": "The Met Collection API",
    "discipline": "Humanidades y cultura",
    "url": "https://collectionapi.metmuseum.org/public/collection/v1/search",
    "access": "none",
    "priority": "P2",
    "purpose": "Historia del arte, obras y colecciones",
    "notes": "Recursos y derechos por obra",
    "productionVerified": false
  },
  {
    "id": "gdelt-2-0-doc",
    "name": "GDELT 2.0 DOC",
    "discipline": "Actualidad contextual",
    "url": "https://api.gdeltproject.org/api/v2/doc/doc",
    "access": "none_limited",
    "priority": "P2",
    "purpose": "Noticias mundiales y búsqueda mediática",
    "notes": "No es evidencia científica ni verifica veracidad de noticias",
    "productionVerified": false
  },
  {
    "id": "patentsview-search-api",
    "name": "PatentsView Search API",
    "discipline": "Patentes: no anónima",
    "url": "https://search.patentsview.org/api/v1",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Búsqueda de patentes EEUU",
    "notes": "Requiere clave; altas nuevas pueden estar suspendidas",
    "productionVerified": false
  },
  {
    "id": "uspto-open-data-portal-api",
    "name": "USPTO Open Data Portal API",
    "discipline": "Patentes: no anónima",
    "url": "https://data.uspto.gov/apis/getting-started",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Expedientes y patentes estadounidenses",
    "notes": "Clave requerida; alternativa descarga bulk sin clave",
    "productionVerified": false
  },
  {
    "id": "epo-open-patent-services",
    "name": "EPO Open Patent Services",
    "discipline": "Patentes: no anónima",
    "url": "https://developers.epo.org/",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Patentes europeas",
    "notes": "Registro y credenciales, excluir del modo anónimo",
    "productionVerified": false
  },
  {
    "id": "orcid-public-api-registrada",
    "name": "ORCID Public API registrada",
    "discipline": "Identificadores: no anónima",
    "url": "https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Identidad y obras de investigadores",
    "notes": "OAuth Client ID y secreto; usar datos OpenAlex/ROR mientras tanto",
    "productionVerified": false
  },
  {
    "id": "fred-api",
    "name": "FRED API",
    "discipline": "Estadística: no anónima",
    "url": "https://fred.stlouisfed.org/docs/api/fred/",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Series económicas Reserva Federal EEUU",
    "notes": "Requiere clave; usar World Bank/OECD/IMF como alternativa",
    "productionVerified": false
  },
  {
    "id": "core-api",
    "name": "CORE API",
    "discipline": "Bibliografía: no anónima",
    "url": "https://core.ac.uk/services/api",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Texto y metadatos académicos",
    "notes": "Requiere clave; sustituir por Europe PMC y repositorios",
    "productionVerified": false
  },
  {
    "id": "google-scholar",
    "name": "Google Scholar",
    "discipline": "Sin API pública oficial",
    "url": "https://scholar.google.com/",
    "access": "no_official_api",
    "priority": "OFF",
    "purpose": "Búsqueda bibliográfica web",
    "notes": "No usar scraping automatizado como API oficial",
    "productionVerified": false
  },
  {
    "id": "scopus-api",
    "name": "Scopus API",
    "discipline": "Bibliografía: no anónima",
    "url": "https://dev.elsevier.com/",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Bibliometría propietaria",
    "notes": "Necesita API key y condiciones de licencia",
    "productionVerified": false
  },
  {
    "id": "web-of-science-api",
    "name": "Web of Science API",
    "discipline": "Bibliografía: no anónima",
    "url": "https://developer.clarivate.com/",
    "access": "key_required",
    "priority": "OFF",
    "purpose": "Citaciones e indexación propietaria",
    "notes": "Requiere credenciales",
    "productionVerified": false
  }
]

const ANONYMOUS_ACCESS = new Set(['none', 'none_limited'])

/** Explicitly keep unverified, key-only and conditional sources out of automatic anonymous dispatch. */
export function listResearchCatalog(
  discipline = '', mode: 'anonymous' | 'all' = 'anonymous', limit = 25,
): { total: number; matched: number; sources: ResearchCatalogEntry[] } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ToolArgsError(['limit must be an integer between 1 and 100'])
  }
  const topic = discipline.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase()
  const filtered = RESEARCH_API_CATALOG.filter(source => {
    if (mode === 'anonymous' && !ANONYMOUS_ACCESS.has(source.access)) return false
    const context = (source.discipline + ' ' + source.name + ' ' + source.purpose)
      .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    return topic === '' || context.includes(topic)
  })
  return { total: RESEARCH_API_CATALOG.length, matched: filtered.length, sources: filtered.slice(0, limit) }
}

/** Retrieve structured source candidates; not an authenticated search or live-availability claim. */
export function createResearchCatalogTool(): ToolDefinition {
  return defineTool({
    name: 'research_catalog',
    description: 'Consulta el catálogo de 100 bases científicas y datos oficiales de PHOENIX. Filtra por disciplina y distingue acceso anónimo confirmado documentalmente de fuentes condicionales o que requieren credenciales. No equipares un catálogo con una API funcional. Para artículos utiliza research_federated o research_scholar.',
    parameters: {
      discipline: { type: 'string', description: 'Tema o disciplina: medicina, economía, física, software, biodiversidad, educación, derecho, etc.' },
      mode: { type: 'string', description: 'anonymous (por defecto, solo documentación de lectura sin clave) o all (también condicionadas).' },
      limit: { type: 'integer', description: 'Número máximo de fuentes, de 1 a 100; por defecto 25.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute(args) {
      const mode = args.mode ?? 'anonymous'
      if (mode !== 'anonymous' && mode !== 'all') throw new ToolArgsError(['mode must be anonymous or all'])
      const selection = listResearchCatalog(args.discipline ?? '', mode, args.limit ?? 25)
      return Promise.resolve({
        ...selection,
        mode,
        note: 'Catálogo curado, no estado de disponibilidad. Comprobar endpoint, licencia, presupuesto, permisos y pertinencia antes de consultar. No ejecutar fuentes no verificadas.',
      } as unknown as Record<string, JsonValue>)
    },
  })
}
