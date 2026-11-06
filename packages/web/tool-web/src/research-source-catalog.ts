/** Curated public research catalog: metadata and access eligibility, not live API health. */
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

/** Compact tuples avoid repeating object-property syntax in the bundled catalog. */
const SOURCE_ROWS: readonly (readonly [string, string, string, string, string, string, string, string, boolean])[] = [
  ['openalex', 'OpenAlex', 'Bibliografía', 'https://api.openalex.org/works', 'none_limited', 'P0', 'Publicaciones, grafo bibliográfico, autores, temas y citas', 'Sin clave para búsquedas básicas; cursor profundo exige clave gratuita', false],
  ['crossref', 'Crossref', 'Bibliografía', 'https://api.crossref.org/works', 'none', 'P0', 'DOI, bibliografía, editorial, revistas y actualizaciones', 'Pool público limitado; usar mailto/agent para polite', false],
  ['semantic-scholar', 'Semantic Scholar', 'Bibliografía', 'https://api.semanticscholar.org/graph/v1/paper/search', 'none_limited', 'P0', 'Descubrimiento científico y red de citas', 'Cuota anónima global compartida; algunas operaciones exigen clave', false],
  ['openaire-graph-v4', 'OpenAIRE Graph v4', 'Bibliografía', 'https://api.openaire.eu/graph/v4/research-products', 'none_limited', 'P0', 'Publicaciones, software, datasets y proyectos financiados', 'Consultar políticas de tráfico y filtrado', false],
  ['datacite', 'DataCite', 'Bibliografía', 'https://api.datacite.org/dois', 'none', 'P0', 'DOI de datos, software y otros resultados de investigación', 'Metadatos; no implica acceso al contenido', false],
  ['opencitations', 'OpenCitations', 'Bibliografía', 'https://api.opencitations.net/index/v2', 'none_limited', 'P1', 'Citas abiertas y relaciones bibliográficas', 'Token opcional para mayor capacidad', false],
  ['doaj', 'DOAJ', 'Bibliografía', 'https://doaj.org/api/search/articles/', 'none_limited', 'P1', 'Artículos y revistas de acceso abierto', 'Validar cobertura, tipos de licencia y ruta vigente', false],
  ['dblp', 'DBLP', 'Bibliografía', 'https://dblp.org/search/publ/api', 'none_limited', 'P1', 'Informática, autores, congresos y bibliografía', 'No es repositorio de texto completo', false],
  ['arxiv', 'arXiv', 'Bibliografía', 'https://export.arxiv.org/api/query', 'none_limited', 'P1', 'Preprints de física, matemáticas, computación y estadística', 'Separar solicitudes >= 3 segundos', false],
  ['europe-pmc', 'Europe PMC', 'Bibliografía', 'https://www.ebi.ac.uk/europepmc/webservices/rest/search', 'none', 'P0', 'Literatura biomédica, citas, abstracs y texto completo abierto', 'Distinguir publicaciones y preprints', false],
  ['ncbi-pubmed', 'NCBI PubMed', 'Bibliografía', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', 'none_limited', 'P0', 'Medicina, salud pública, artículos y tesauro MeSH', '3 solicitudes/segundo por IP sin clave', false],
  ['nih-pubmed-central-oai-pmh', 'NIH PubMed Central OAI-PMH', 'Repositorios', 'https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/', 'none', 'P0', 'Metadatos y texto de subconjunto legalmente reutilizable', 'El resto de PMC puede tener restricciones de licencia', false],
  ['pmc-bioc', 'PMC BioC', 'Repositorios', 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi', 'none', 'P0', 'Texto completo de PMC Open Access en BioC JSON/XML', 'Solo subconjunto permitido por licencia', false],
  ['bioc-pubmed', 'BioC PubMed', 'Repositorios', 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi', 'none', 'P1', 'Text mining de abstracts y metadatos PubMed', 'No confundir con texto completo', false],
  ['biorxiv', 'bioRxiv', 'Repositorios', 'https://api.biorxiv.org/details/biorxiv/', 'none', 'P1', 'Preprints de biología y versiones', 'Preprint no revisado por pares', false],
  ['medrxiv', 'medRxiv', 'Repositorios', 'https://api.biorxiv.org/details/medrxiv/', 'none', 'P1', 'Preprints de medicina', 'No usar como evidencia clínica establecida', false],
  ['hal', 'HAL', 'Repositorios', 'https://api.archives-ouvertes.fr/search/', 'none', 'P1', 'Repositorio académico multidisciplinario europeo', 'Cobertura por depósitos', false],
  ['zenodo', 'Zenodo', 'Repositorios', 'https://zenodo.org/api/records', 'none', 'P1', 'Datasets, informes, preprints, software y resultados DOI', 'Verificar archivos y licencia', false],
  ['figshare', 'Figshare', 'Repositorios', 'https://api.figshare.com/v2/articles', 'none', 'P1', 'Datos y materiales asociados a investigaciones', 'Metadatos y licencias por recurso', false],
  ['open-science-framework', 'Open Science Framework', 'Repositorios', 'https://api.osf.io/v2/nodes/', 'none_limited', 'P1', 'Prerregistros, proyectos y preprints públicos', 'Solo recursos públicos; algunos métodos requieren token', false],
  ['plos-search', 'PLOS Search', 'Repositorios', 'https://api.plos.org/search', 'none', 'P1', 'Artículos de revistas PLOS', 'Cobertura limitada a PLOS', false],
  ['scielo-articlemeta', 'SciELO ArticleMeta', 'Repositorios', 'https://articlemeta.scielo.org/', 'needs_validation', 'P1', 'Literatura latinoamericana en español y portugués', 'Confirmar operaciones disponibles en cada despliegue', false],
  ['internet-archive-advanced-search', 'Internet Archive Advanced Search', 'Repositorios', 'https://archive.org/advancedsearch.php', 'none_limited', 'P2', 'Libros, colecciones y documentos digitales', 'Los derechos de acceso varían', false],
  ['ror-registry', 'ROR Registry', 'Identificadores', 'https://api.ror.org/v2/organizations', 'none', 'P1', 'Identidad fiable de universidades y organismos', 'Cupo 2.000 solicitudes/5 minutos según documentación', false],
  ['unpaywall-doi', 'Unpaywall DOI', 'Identificadores', 'https://api.unpaywall.org/v2/', 'email_required', 'P1', 'Localiza copias legítimas de acceso abierto por DOI', 'Correo electrónico real obligatorio; sin búsqueda libre por texto', false],
  ['wikidata-sparql', 'Wikidata SPARQL', 'Identificadores', 'https://query.wikidata.org/sparql', 'none_limited', 'P2', 'Entidades, relaciones e identificadores universales', 'No es evidencia científica primaria; migración backend 2026-27', false],
  ['clinicaltrials-gov-v2', 'ClinicalTrials.gov v2', 'Biomedicina', 'https://clinicaltrials.gov/api/v2/studies', 'none', 'P0', 'Registros y resultados de ensayos clínicos', 'Registro no equivale a eficacia demostrada', false],
  ['nih-icite', 'NIH iCite', 'Biomedicina', 'https://icite.od.nih.gov/api/pubs', 'none_limited', 'P1', 'Bibliometría científica y citación relativa', 'No sustituye evaluación metodológica', false],
  ['openfda', 'openFDA', 'Biomedicina', 'https://api.fda.gov/drug/event.json', 'conditional_docs', 'P1', 'Eventos adversos, etiquetado y dispositivos regulados', 'Documentación contradictoria: indica clave requerida pero publica cuota anónima', false],
  ['pubchem-pug-rest', 'PubChem PUG REST', 'Biomedicina', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug', 'none_limited', 'P0', 'Química, sustancias, bioactividad y propiedades', 'No superar 5 solicitudes/segundo por IP', false],
  ['chembl', 'ChEMBL', 'Biomedicina', 'https://www.ebi.ac.uk/chembl/api/data', 'none', 'P1', 'Bioactividad farmacológica y ensayos químicos', 'Datos heterogéneos, normalizar unidades', false],
  ['chebi', 'ChEBI', 'Biomedicina', 'https://www.ebi.ac.uk/chebi/backend/api/public', 'none', 'P1', 'Entidades químicas y ontologías', 'Confirmar ruta por versión', false],
  ['uniprot', 'UniProt', 'Biomedicina', 'https://rest.uniprot.org/uniprotkb/search', 'none', 'P1', 'Proteínas, anotaciones y literatura vinculada', 'Diferenciar anotación revisada vs automática', false],
  ['ensembl', 'Ensembl', 'Biomedicina', 'https://rest.ensembl.org', 'none_limited', 'P1', 'Genes, variantes y genomas', 'Cupo por IP y especies', false],
  ['rcsb-pdb-search', 'RCSB PDB Search', 'Biomedicina', 'https://search.rcsb.org/rcsbsearch/v2/query', 'none', 'P1', 'Búsqueda de estructuras biomoleculares', 'POST con JSON estructurado', false],
  ['rcsb-pdb-data', 'RCSB PDB Data', 'Biomedicina', 'https://data.rcsb.org/graphql', 'none', 'P1', 'Detalles estructurales PDB', 'GraphQL POST, comprobar errors[] aunque HTTP 200', false],
  ['reactome', 'Reactome', 'Biomedicina', 'https://reactome.org/ContentService', 'none', 'P1', 'Rutas de señalización y metabolismo', 'Cambios de release afectan interpretaciones', false],
  ['gwas-catalog-rest-v2', 'GWAS Catalog REST v2', 'Biomedicina', 'https://www.ebi.ac.uk/gwas/rest/api/v2', 'none_limited', 'P1', 'Asociación genómica, variantes y fenotipos', 'Solo v2; v1 retirada agosto 2026; 100 req/min, 15 req/s', false],
  ['open-targets', 'Open Targets', 'Biomedicina', 'https://api.platform.opentargets.org/api/v4/graphql', 'none', 'P1', 'Dianas terapéuticas, enfermedades, fármacos y variantes', 'GraphQL; registrar release y no confundir score con causalidad', false],
  ['ebi-ena', 'EBI ENA', 'Biomedicina', 'https://www.ebi.ac.uk/ena/portal/api/search', 'none', 'P1', 'Secuencias y datos genómicos', 'Usar filtros result correctos', false],
  ['ebi-ontology-lookup-ols4', 'EBI Ontology Lookup OLS4', 'Biomedicina', 'https://www.ebi.ac.uk/ols4/api/search', 'none', 'P1', 'Vocabularios biomédicos y ontologías', 'Resolver sinónimos y relaciones', false],
  ['ebi-search', 'EBI Search', 'Biomedicina', 'https://www.ebi.ac.uk/ebisearch/ws/rest', 'none', 'P2', 'Búsqueda federada de recursos EMBL-EBI', 'Verificar dominios/colecciones', false],
  ['interpro', 'InterPro', 'Biomedicina', 'https://www.ebi.ac.uk/interpro/api/entry/interpro/', 'none', 'P1', 'Familias y dominios de proteínas', 'Paginación', false],
  ['quickgo', 'QuickGO', 'Biomedicina', 'https://www.ebi.ac.uk/QuickGO/services/ontology/go/search', 'none', 'P1', 'Gene Ontology y anotaciones funcionales', 'Interpretar evidencia experimental vs inferida', false],
  ['ncbi-gene', 'NCBI Gene', 'Biomedicina', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene', 'none_limited', 'P1', 'Identificadores y anotaciones genéticas', 'Comparte límite NCBI', false],
  ['ncbi-clinvar', 'NCBI ClinVar', 'Biomedicina', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar', 'none_limited', 'P1', 'Variantes y significancia clínica', 'Conflictos entre submitters deben reflejarse', false],
  ['ncbi-geo', 'NCBI GEO', 'Biomedicina', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds', 'none_limited', 'P1', 'Expresión génica y experimentos ómicos', 'Diferenciar depósito y revisión de calidad', false],
  ['medlineplus-connect', 'MedlinePlus Connect', 'Biomedicina', 'https://connect.medlineplus.gov/service', 'none', 'P2', 'Información sanitaria ligada a códigos', 'Información educativa, no guía clínica individual', false],
  ['dailymed-spl-api', 'DailyMed SPL API', 'Biomedicina', 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json', 'none', 'P1', 'Etiquetado farmacológico oficial estadounidense', 'Verificar versión del medicamento y jurisdicción', false],
  ['world-bank-indicators', 'World Bank Indicators', 'Estadística y políticas', 'https://api.worldbank.org/v2', 'none', 'P0', 'Indicadores económicos, sociales, educativos y sanitarios', 'Sin API key; revisar año, país y fuente del indicador', false],
  ['who-global-health-observatory', 'WHO Global Health Observatory', 'Estadística y políticas', 'https://ghoapi.azureedge.net/api/Indicator', 'none', 'P0', 'Indicadores mundiales de salud', 'Interpretar definiciones y estimaciones', false],
  ['oecd-sdmx', 'OECD SDMX', 'Estadística y políticas', 'https://sdmx.oecd.org/public/rest/v1', 'none_limited', 'P0', 'Economía, empleo, educación, salud y política pública', 'Límites de solicitudes y dimensiones SDMX', false],
  ['eurostat-rest', 'Eurostat REST', 'Estadística y políticas', 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data', 'none', 'P0', 'Estadística europea oficial', 'JSON-stat, SDMX; no hay historial de versiones', false],
  ['imf-sdmx', 'IMF SDMX', 'Estadística y políticas', 'https://api.imf.org/external/sdmx/3.0', 'needs_validation', 'P1', 'Moneda, cuentas, balanza y macroeconomía', 'Verificar raíz vigente y acceso público en la nueva plataforma', false],
  ['us-census-api', 'US Census API', 'Estadística y políticas', 'https://api.census.gov/data', 'none_limited', 'P1', 'Población, educación, vivienda y demografía EEUU', '500 solicitudes/día/IP sin clave', false],
  ['cdc-open-data-socrata', 'CDC Open Data Socrata', 'Estadística y políticas', 'https://data.cdc.gov', 'none_limited', 'P1', 'Vigilancia y datos de salud pública', 'Cada dataset tiene un id; token opcional aumenta cuota', false],
  ['uk-national-data-library-ckan', 'UK National Data Library CKAN', 'Estadística y políticas', 'https://data.gov.uk/api/action/package_search', 'none', 'P1', 'Catálogo de datos oficiales del Reino Unido', 'Devuelve datasets, no siempre datos descargados', false],
  ['datos-abiertos-republica-dominicana-ckan', 'Datos Abiertos República Dominicana CKAN', 'Estadística y políticas', 'https://datos.gob.do/api/3/action/package_search', 'none_expected', 'P0', 'Catálogo de datos gubernamentales dominicanos', 'Confirmar estabilidad/actualización de cada recurso', false],
  ['un-comtrade-preview', 'UN Comtrade Preview', 'Estadística y políticas', 'https://comtradeapi.un.org/public/v1/preview', 'none_limited', 'P1', 'Comercio internacional y estadísticas por producto', 'Preview hasta 500 registros; extracciones completas requieren clave', false],
  ['unhcr-refugee-data-api', 'UNHCR Refugee Data API', 'Estadística y políticas', 'https://api.unhcr.org/population/v1/', 'none_expected', 'P1', 'Refugiados y desplazamiento poblacional', 'Verificar política y esquema actuales', false],
  ['sec-edgar-api', 'SEC EDGAR API', 'Estadística y políticas', 'https://data.sec.gov', 'none_limited', 'P1', 'Estados financieros XBRL y reportes corporativos', 'User-Agent e identificación y respeto a Fair Access', false],
  ['us-data-gov-ckan', 'US Data.gov CKAN', 'Estadística y políticas', 'https://catalog.data.gov/api/3/action/package_search', 'none_expected', 'P1', 'Catálogo de datasets gubernamentales estadounidenses', 'Catálogo CKAN, recursos heterogéneos', false],
  ['faostat', 'FAOSTAT', 'Estadística y políticas', 'https://fenixservices.fao.org/faostat/api/v1/en', 'needs_validation', 'P1', 'Agricultura, alimentos y seguridad alimentaria', 'Verificar vigencia de endpoint y acceso antes de producción', false],
  ['ilostat-sdmx', 'ILOSTAT SDMX', 'Estadística y políticas', 'https://ilostat.ilo.org/data/', 'needs_validation', 'P1', 'Trabajo, salarios, ocupación y empleo', 'Verificar servicio SDMX y endpoints vigentes', false],
  ['usgs-earthquakes-fdsn', 'USGS Earthquakes FDSN', 'Geociencias y ambiente', 'https://earthquake.usgs.gov/fdsnws/event/1/query', 'none', 'P1', 'Sismos, magnitud y localización', 'Para tiempo real preferir feeds GeoJSON', false],
  ['usgs-water-data', 'USGS Water Data', 'Geociencias y ambiente', 'https://api.waterdata.usgs.gov/', 'none_limited', 'P1', 'Caudales, agua y estaciones hidrológicas', 'No usar servicio heredado: cierre 22 febrero 2027', false],
  ['noaa-national-weather-service', 'NOAA National Weather Service', 'Geociencias y ambiente', 'https://api.weather.gov', 'none_limited', 'P1', 'Pronósticos, observaciones y alertas EEUU', 'User-Agent obligatorio/recomendado y límites por uso razonable', false],
  ['noaa-tides-and-currents', 'NOAA Tides and Currents', 'Geociencias y ambiente', 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter', 'none', 'P1', 'Mareas, nivel mar, corrientes y estaciones', 'Limitar período solicitado', false],
  ['gbif', 'GBIF', 'Geociencias y ambiente', 'https://api.gbif.org/v1/occurrence/search', 'none_limited', 'P1', 'Biodiversidad, especies y ocurrencias', 'Descargas masivas autenticadas; GET público', false],
  ['inaturalist', 'INaturalist', 'Geociencias y ambiente', 'https://api.inaturalist.org/v1/observations', 'none_limited', 'P2', 'Observaciones de especies y ciencia ciudadana', 'Datos observacionales pueden requerir validación de identificación', false],
  ['nasa-ntrs', 'NASA NTRS', 'Geociencias y ambiente', 'https://ntrs.nasa.gov/api/citations/search', 'none', 'P1', 'Reportes de ingeniería y ciencia aeroespacial', 'Texto sujeto a disponibilidad y licencia', false],
  ['nasa-osdr', 'NASA OSDR', 'Geociencias y ambiente', 'https://osdr.nasa.gov/osdr/data/osd/meta/', 'none_expected', 'P2', 'Experimentos científicos espaciales', 'Verificar API versión y campos', false],
  ['open-meteo', 'Open-Meteo', 'Geociencias y ambiente', 'https://api.open-meteo.com/v1/forecast', 'none_noncommercial', 'P2', 'Datos meteorológicos y pronóstico', 'Plan sin clave solo para uso no comercial con condiciones', false],
  ['openstreetmap-overpass', 'OpenStreetMap Overpass', 'Geociencias y ambiente', 'https://overpass-api.de/api/interpreter', 'none_limited', 'P2', 'Objetos geográficos OSM', 'Respeto a límites públicos; no usar búsquedas pesadas por defecto', false],
  ['openstreetmap-nominatim', 'OpenStreetMap Nominatim', 'Geociencias y ambiente', 'https://nominatim.openstreetmap.org/search', 'none_limited', 'P2', 'Geocodificación y nombres de lugares', 'Servidor público máximo 1 solicitud/segundo; cachear', false],
  ['federal-register-api', 'Federal Register API', 'Derecho y regulación', 'https://www.federalregister.gov/api/v1/documents.json', 'none', 'P1', 'Normas, propuestas y avisos federales de EEUU', 'Verificar contra edición oficial para efectos jurídicos', false],
  ['uk-legislation-api', 'UK Legislation API', 'Derecho y regulación', 'https://www.legislation.gov.uk/openapi', 'none', 'P1', 'Leyes británicas, cambios y notas', 'Verificar entrada en vigor y jurisdicción', false],
  ['eu-publications-office-cellar-sparql', 'EU Publications Office CELLAR SPARQL', 'Derecho y regulación', 'https://publications.europa.eu/webapi/rdf/sparql', 'none_limited', 'P1', 'Normativa de UE y relaciones jurídicas', 'Consultas SPARQL; validación de cambios y textos oficiales', false],
  ['ecfr-developer-api', 'ECFR Developer API', 'Derecho y regulación', 'https://www.ecfr.gov/developers/documentation/api/v1', 'none_expected', 'P1', 'Código de regulaciones federales estadounidenses', 'Comprobar versiones de texto y vigencia', false],
  ['github-rest-public', 'GitHub REST Public', 'Software y tecnología', 'https://api.github.com/search/repositories', 'none_limited', 'P1', 'Repositorios públicos, proyectos de software', 'Bajo límite anónimo de búsqueda; no evalúa calidad automáticamente', false],
  ['hugging-face-hub-public', 'Hugging Face Hub Public', 'Software y tecnología', 'https://huggingface.co/api/models', 'none_limited', 'P1', 'Modelos y datasets de IA de libre acceso', 'Model cards y licencias; no equivale a calidad de investigación', false],
  ['pypi-json-api', 'PyPI JSON API', 'Software y tecnología', 'https://pypi.org/pypi/requests/json', 'none', 'P1', 'Metadatos y versiones de paquetes Python', 'No usar versión nueva como evidencia de seguridad', false],
  ['npm-registry', 'npm Registry', 'Software y tecnología', 'https://registry.npmjs.org/react', 'none', 'P1', 'Paquetes JavaScript', 'Datos de editor, dependencias y versiones', false],
  ['crates-io-api', 'Crates.io API', 'Software y tecnología', 'https://crates.io/api/v1/crates', 'none_limited', 'P2', 'Ecosistema Rust', 'Incluir User-Agent y respetar política de uso', false],
  ['osv-dev-api', 'OSV.dev API', 'Software y tecnología', 'https://api.osv.dev/v1/query', 'none', 'P1', 'Vulnerabilidades de dependencias open source', 'Consulta principalmente por paquete/versión/commit', false],
  ['nist-nvd-cve-api', 'NIST NVD CVE API', 'Software y tecnología', 'https://services.nvd.nist.gov/rest/json/cves/2.0', 'none_limited', 'P1', 'CVE y evaluación de vulnerabilidades', 'Límites anónimos estrictos; programar cache incremental', false],
  ['stack-exchange-api', 'Stack Exchange API', 'Software y tecnología', 'https://api.stackexchange.com/2.3/search/advanced', 'none_limited', 'P2', 'Problemas técnicos y soluciones comunitarias', 'No es fuente científica revisada por pares', false],
  ['open-library-search', 'Open Library Search', 'Humanidades y cultura', 'https://openlibrary.org/search.json', 'none_limited', 'P2', 'Libros, ediciones y autores', 'Catalogación de origen mixto', false],
  ['library-of-congress-json', 'Library of Congress JSON', 'Humanidades y cultura', 'https://www.loc.gov/books/?fo=json', 'none_limited', 'P2', 'Colecciones históricas, libros y documentos', 'No implica permiso de redistribución', false],
  ['the-met-collection-api', 'The Met Collection API', 'Humanidades y cultura', 'https://collectionapi.metmuseum.org/public/collection/v1/search', 'none', 'P2', 'Historia del arte, obras y colecciones', 'Recursos y derechos por obra', false],
  ['gdelt-2-0-doc', 'GDELT 2.0 DOC', 'Actualidad contextual', 'https://api.gdeltproject.org/api/v2/doc/doc', 'none_limited', 'P2', 'Noticias mundiales y búsqueda mediática', 'No es evidencia científica ni verifica veracidad de noticias', false],
  ['patentsview-search-api', 'PatentsView Search API', 'Patentes: no anónima', 'https://search.patentsview.org/api/v1', 'key_required', 'OFF', 'Búsqueda de patentes EEUU', 'Requiere clave; altas nuevas pueden estar suspendidas', false],
  ['uspto-open-data-portal-api', 'USPTO Open Data Portal API', 'Patentes: no anónima', 'https://data.uspto.gov/apis/getting-started', 'key_required', 'OFF', 'Expedientes y patentes estadounidenses', 'Clave requerida; alternativa descarga bulk sin clave', false],
  ['epo-open-patent-services', 'EPO Open Patent Services', 'Patentes: no anónima', 'https://developers.epo.org/', 'key_required', 'OFF', 'Patentes europeas', 'Registro y credenciales, excluir del modo anónimo', false],
  ['orcid-public-api-registrada', 'ORCID Public API registrada', 'Identificadores: no anónima', 'https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/', 'key_required', 'OFF', 'Identidad y obras de investigadores', 'OAuth Client ID y secreto; usar datos OpenAlex/ROR mientras tanto', false],
  ['fred-api', 'FRED API', 'Estadística: no anónima', 'https://fred.stlouisfed.org/docs/api/fred/', 'key_required', 'OFF', 'Series económicas Reserva Federal EEUU', 'Requiere clave; usar World Bank/OECD/IMF como alternativa', false],
  ['core-api', 'CORE API', 'Bibliografía: no anónima', 'https://core.ac.uk/services/api', 'key_required', 'OFF', 'Texto y metadatos académicos', 'Requiere clave; sustituir por Europe PMC y repositorios', false],
  ['google-scholar', 'Google Scholar', 'Sin API pública oficial', 'https://scholar.google.com/', 'no_official_api', 'OFF', 'Búsqueda bibliográfica web', 'No usar scraping automatizado como API oficial', false],
  ['scopus-api', 'Scopus API', 'Bibliografía: no anónima', 'https://dev.elsevier.com/', 'key_required', 'OFF', 'Bibliometría propietaria', 'Necesita API key y condiciones de licencia', false],
  ['web-of-science-api', 'Web of Science API', 'Bibliografía: no anónima', 'https://developer.clarivate.com/', 'key_required', 'OFF', 'Citaciones e indexación propietaria', 'Requiere credenciales', false],
]

/** Catalog records are informational. Only five scholarly providers have live adapters. */
export const RESEARCH_API_CATALOG: readonly ResearchCatalogEntry[] =
  SOURCE_ROWS.map(([id, name, discipline, url, access, priority, purpose, notes, productionVerified]) =>
    ({ id, name, discipline, url, access, priority, purpose, notes, productionVerified }))

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
