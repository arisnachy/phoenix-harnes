# PHOENIX · Catálogo de fuentes para investigación universal

**Versión de investigación:** 6 de noviembre de 2026.

Este catálogo no representa conectores ya implementados ni probados en producción. Las URLs son bases o documentación; cada operación requiere adaptador. Una fuente abierta no garantiza texto completo o licencia libre.

## Leyenda

* `none`: consulta pública sin clave documentada.
* `none_limited`: consulta anónima con límites.
* `none_expected`: pendiente prueba de operación anónima.
* `none_noncommercial`: condiciones no comerciales.
* `email_required`: sin clave, pero con correo válido.
* `conditional_docs`: documentación contradictoria/según operación.
* `needs_validation`: validar API y endpoint antes de habilitar.
* `key_required`: no habilitar en modo sin clave.
* `no_official_api`: no hay API pública oficial.

## Bibliografía

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| OpenAlex | `none_limited` | P0 | [Enlace](https://api.openalex.org/works) | Publicaciones, grafo bibliográfico, autores, temas y citas | Sin clave para búsquedas básicas; cursor profundo exige clave gratuita |
| Crossref | `none` | P0 | [Enlace](https://api.crossref.org/works) | DOI, bibliografía, editorial, revistas y actualizaciones | Pool público limitado; usar mailto/agent para polite |
| Semantic Scholar | `none_limited` | P0 | [Enlace](https://api.semanticscholar.org/graph/v1/paper/search) | Descubrimiento científico y red de citas | Cuota anónima global compartida; algunas operaciones exigen clave |
| OpenAIRE Graph v4 | `none_limited` | P0 | [Enlace](https://api.openaire.eu/graph/v4/research-products) | Publicaciones, software, datasets y proyectos financiados | Consultar políticas de tráfico y filtrado |
| DataCite | `none` | P0 | [Enlace](https://api.datacite.org/dois) | DOI de datos, software y otros resultados de investigación | Metadatos; no implica acceso al contenido |
| OpenCitations | `none_limited` | P1 | [Enlace](https://api.opencitations.net/index/v2) | Citas abiertas y relaciones bibliográficas | Token opcional para mayor capacidad |
| DOAJ | `none_limited` | P1 | [Enlace](https://doaj.org/api/search/articles/) | Artículos y revistas de acceso abierto | Validar cobertura, tipos de licencia y ruta vigente |
| DBLP | `none_limited` | P1 | [Enlace](https://dblp.org/search/publ/api) | Informática, autores, congresos y bibliografía | No es repositorio de texto completo |
| arXiv | `none_limited` | P1 | [Enlace](https://export.arxiv.org/api/query) | Preprints de física, matemáticas, computación y estadística | Separar solicitudes >= 3 segundos |
| Europe PMC | `none` | P0 | [Enlace](https://www.ebi.ac.uk/europepmc/webservices/rest/search) | Literatura biomédica, citas, abstracs y texto completo abierto | Distinguir publicaciones y preprints |
| NCBI PubMed | `none_limited` | P0 | [Enlace](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi) | Medicina, salud pública, artículos y tesauro MeSH | 3 solicitudes/segundo por IP sin clave |

## Repositorios

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| NIH PubMed Central OAI-PMH | `none` | P0 | [Enlace](https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/) | Metadatos y texto de subconjunto legalmente reutilizable | El resto de PMC puede tener restricciones de licencia |
| PMC BioC | `none` | P0 | [Enlace](https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi) | Texto completo de PMC Open Access en BioC JSON/XML | Solo subconjunto permitido por licencia |
| BioC PubMed | `none` | P1 | [Enlace](https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi) | Text mining de abstracts y metadatos PubMed | No confundir con texto completo |
| bioRxiv | `none` | P1 | [Enlace](https://api.biorxiv.org/details/biorxiv/) | Preprints de biología y versiones | Preprint no revisado por pares |
| medRxiv | `none` | P1 | [Enlace](https://api.biorxiv.org/details/medrxiv/) | Preprints de medicina | No usar como evidencia clínica establecida |
| HAL | `none` | P1 | [Enlace](https://api.archives-ouvertes.fr/search/) | Repositorio académico multidisciplinario europeo | Cobertura por depósitos |
| Zenodo | `none` | P1 | [Enlace](https://zenodo.org/api/records) | Datasets, informes, preprints, software y resultados DOI | Verificar archivos y licencia |
| Figshare | `none` | P1 | [Enlace](https://api.figshare.com/v2/articles) | Datos y materiales asociados a investigaciones | Metadatos y licencias por recurso |
| Open Science Framework | `none_limited` | P1 | [Enlace](https://api.osf.io/v2/nodes/) | Prerregistros, proyectos y preprints públicos | Solo recursos públicos; algunos métodos requieren token |
| PLOS Search | `none` | P1 | [Enlace](https://api.plos.org/search) | Artículos de revistas PLOS | Cobertura limitada a PLOS |
| SciELO ArticleMeta | `needs_validation` | P1 | [Enlace](https://articlemeta.scielo.org/) | Literatura latinoamericana en español y portugués | Confirmar operaciones disponibles en cada despliegue |
| Internet Archive Advanced Search | `none_limited` | P2 | [Enlace](https://archive.org/advancedsearch.php) | Libros, colecciones y documentos digitales | Los derechos de acceso varían |

## Identificadores

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| ROR Registry | `none` | P1 | [Enlace](https://api.ror.org/v2/organizations) | Identidad fiable de universidades y organismos | Cupo 2.000 solicitudes/5 minutos según documentación |
| Unpaywall DOI | `email_required` | P1 | [Enlace](https://api.unpaywall.org/v2/) | Localiza copias legítimas de acceso abierto por DOI | Correo electrónico real obligatorio; sin búsqueda libre por texto |
| Wikidata SPARQL | `none_limited` | P2 | [Enlace](https://query.wikidata.org/sparql) | Entidades, relaciones e identificadores universales | No es evidencia científica primaria; migración backend 2026-27 |

## Biomedicina

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| ClinicalTrials.gov v2 | `none` | P0 | [Enlace](https://clinicaltrials.gov/api/v2/studies) | Registros y resultados de ensayos clínicos | Registro no equivale a eficacia demostrada |
| NIH iCite | `none_limited` | P1 | [Enlace](https://icite.od.nih.gov/api/pubs) | Bibliometría científica y citación relativa | No sustituye evaluación metodológica |
| openFDA | `conditional_docs` | P1 | [Enlace](https://api.fda.gov/drug/event.json) | Eventos adversos, etiquetado y dispositivos regulados | Documentación contradictoria: indica clave requerida pero publica cuota anónima |
| PubChem PUG REST | `none_limited` | P0 | [Enlace](https://pubchem.ncbi.nlm.nih.gov/rest/pug) | Química, sustancias, bioactividad y propiedades | No superar 5 solicitudes/segundo por IP |
| ChEMBL | `none` | P1 | [Enlace](https://www.ebi.ac.uk/chembl/api/data) | Bioactividad farmacológica y ensayos químicos | Datos heterogéneos, normalizar unidades |
| ChEBI | `none` | P1 | [Enlace](https://www.ebi.ac.uk/chebi/backend/api/public) | Entidades químicas y ontologías | Confirmar ruta por versión |
| UniProt | `none` | P1 | [Enlace](https://rest.uniprot.org/uniprotkb/search) | Proteínas, anotaciones y literatura vinculada | Diferenciar anotación revisada vs automática |
| Ensembl | `none_limited` | P1 | [Enlace](https://rest.ensembl.org) | Genes, variantes y genomas | Cupo por IP y especies |
| RCSB PDB Search | `none` | P1 | [Enlace](https://search.rcsb.org/rcsbsearch/v2/query) | Búsqueda de estructuras biomoleculares | POST con JSON estructurado |
| RCSB PDB Data | `none` | P1 | [Enlace](https://data.rcsb.org/graphql) | Detalles estructurales PDB | GraphQL POST, comprobar errors[] aunque HTTP 200 |
| Reactome | `none` | P1 | [Enlace](https://reactome.org/ContentService) | Rutas de señalización y metabolismo | Cambios de release afectan interpretaciones |
| GWAS Catalog REST v2 | `none_limited` | P1 | [Enlace](https://www.ebi.ac.uk/gwas/rest/api/v2) | Asociación genómica, variantes y fenotipos | Solo v2; v1 retirada agosto 2026; 100 req/min, 15 req/s |
| Open Targets | `none` | P1 | [Enlace](https://api.platform.opentargets.org/api/v4/graphql) | Dianas terapéuticas, enfermedades, fármacos y variantes | GraphQL; registrar release y no confundir score con causalidad |
| EBI ENA | `none` | P1 | [Enlace](https://www.ebi.ac.uk/ena/portal/api/search) | Secuencias y datos genómicos | Usar filtros result correctos |
| EBI Ontology Lookup OLS4 | `none` | P1 | [Enlace](https://www.ebi.ac.uk/ols4/api/search) | Vocabularios biomédicos y ontologías | Resolver sinónimos y relaciones |
| EBI Search | `none` | P2 | [Enlace](https://www.ebi.ac.uk/ebisearch/ws/rest) | Búsqueda federada de recursos EMBL-EBI | Verificar dominios/colecciones |
| InterPro | `none` | P1 | [Enlace](https://www.ebi.ac.uk/interpro/api/entry/interpro/) | Familias y dominios de proteínas | Paginación |
| QuickGO | `none` | P1 | [Enlace](https://www.ebi.ac.uk/QuickGO/services/ontology/go/search) | Gene Ontology y anotaciones funcionales | Interpretar evidencia experimental vs inferida |
| NCBI Gene | `none_limited` | P1 | [Enlace](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene) | Identificadores y anotaciones genéticas | Comparte límite NCBI |
| NCBI ClinVar | `none_limited` | P1 | [Enlace](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar) | Variantes y significancia clínica | Conflictos entre submitters deben reflejarse |
| NCBI GEO | `none_limited` | P1 | [Enlace](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds) | Expresión génica y experimentos ómicos | Diferenciar depósito y revisión de calidad |
| MedlinePlus Connect | `none` | P2 | [Enlace](https://connect.medlineplus.gov/service) | Información sanitaria ligada a códigos | Información educativa, no guía clínica individual |
| DailyMed SPL API | `none` | P1 | [Enlace](https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json) | Etiquetado farmacológico oficial estadounidense | Verificar versión del medicamento y jurisdicción |

## Estadística y políticas

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| World Bank Indicators | `none` | P0 | [Enlace](https://api.worldbank.org/v2) | Indicadores económicos, sociales, educativos y sanitarios | Sin API key; revisar año, país y fuente del indicador |
| WHO Global Health Observatory | `none` | P0 | [Enlace](https://ghoapi.azureedge.net/api/Indicator) | Indicadores mundiales de salud | Interpretar definiciones y estimaciones |
| OECD SDMX | `none_limited` | P0 | [Enlace](https://sdmx.oecd.org/public/rest/v1) | Economía, empleo, educación, salud y política pública | Límites de solicitudes y dimensiones SDMX |
| Eurostat REST | `none` | P0 | [Enlace](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data) | Estadística europea oficial | JSON-stat, SDMX; no hay historial de versiones |
| IMF SDMX | `needs_validation` | P1 | [Enlace](https://api.imf.org/external/sdmx/3.0) | Moneda, cuentas, balanza y macroeconomía | Verificar raíz vigente y acceso público en la nueva plataforma |
| US Census API | `none_limited` | P1 | [Enlace](https://api.census.gov/data) | Población, educación, vivienda y demografía EEUU | 500 solicitudes/día/IP sin clave |
| CDC Open Data Socrata | `none_limited` | P1 | [Enlace](https://data.cdc.gov) | Vigilancia y datos de salud pública | Cada dataset tiene un id; token opcional aumenta cuota |
| UK National Data Library CKAN | `none` | P1 | [Enlace](https://data.gov.uk/api/action/package_search) | Catálogo de datos oficiales del Reino Unido | Devuelve datasets, no siempre datos descargados |
| Datos Abiertos República Dominicana CKAN | `none_expected` | P0 | [Enlace](https://datos.gob.do/api/3/action/package_search) | Catálogo de datos gubernamentales dominicanos | Confirmar estabilidad/actualización de cada recurso |
| UN Comtrade Preview | `none_limited` | P1 | [Enlace](https://comtradeapi.un.org/public/v1/preview) | Comercio internacional y estadísticas por producto | Preview hasta 500 registros; extracciones completas requieren clave |
| UNHCR Refugee Data API | `none_expected` | P1 | [Enlace](https://api.unhcr.org/population/v1/) | Refugiados y desplazamiento poblacional | Verificar política y esquema actuales |
| SEC EDGAR API | `none_limited` | P1 | [Enlace](https://data.sec.gov) | Estados financieros XBRL y reportes corporativos | User-Agent e identificación y respeto a Fair Access |
| US Data.gov CKAN | `none_expected` | P1 | [Enlace](https://catalog.data.gov/api/3/action/package_search) | Catálogo de datasets gubernamentales estadounidenses | Catálogo CKAN, recursos heterogéneos |
| FAOSTAT | `needs_validation` | P1 | [Enlace](https://fenixservices.fao.org/faostat/api/v1/en) | Agricultura, alimentos y seguridad alimentaria | Verificar vigencia de endpoint y acceso antes de producción |
| ILOSTAT SDMX | `needs_validation` | P1 | [Enlace](https://ilostat.ilo.org/data/) | Trabajo, salarios, ocupación y empleo | Verificar servicio SDMX y endpoints vigentes |

## Geociencias y ambiente

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| USGS Earthquakes FDSN | `none` | P1 | [Enlace](https://earthquake.usgs.gov/fdsnws/event/1/query) | Sismos, magnitud y localización | Para tiempo real preferir feeds GeoJSON |
| USGS Water Data | `none_limited` | P1 | [Enlace](https://api.waterdata.usgs.gov/) | Caudales, agua y estaciones hidrológicas | No usar servicio heredado: cierre 22 febrero 2027 |
| NOAA National Weather Service | `none_limited` | P1 | [Enlace](https://api.weather.gov) | Pronósticos, observaciones y alertas EEUU | User-Agent obligatorio/recomendado y límites por uso razonable |
| NOAA Tides and Currents | `none` | P1 | [Enlace](https://api.tidesandcurrents.noaa.gov/api/prod/datagetter) | Mareas, nivel mar, corrientes y estaciones | Limitar período solicitado |
| GBIF | `none_limited` | P1 | [Enlace](https://api.gbif.org/v1/occurrence/search) | Biodiversidad, especies y ocurrencias | Descargas masivas autenticadas; GET público |
| INaturalist | `none_limited` | P2 | [Enlace](https://api.inaturalist.org/v1/observations) | Observaciones de especies y ciencia ciudadana | Datos observacionales pueden requerir validación de identificación |
| NASA NTRS | `none` | P1 | [Enlace](https://ntrs.nasa.gov/api/citations/search) | Reportes de ingeniería y ciencia aeroespacial | Texto sujeto a disponibilidad y licencia |
| NASA OSDR | `none_expected` | P2 | [Enlace](https://osdr.nasa.gov/osdr/data/osd/meta/) | Experimentos científicos espaciales | Verificar API versión y campos |
| Open-Meteo | `none_noncommercial` | P2 | [Enlace](https://api.open-meteo.com/v1/forecast) | Datos meteorológicos y pronóstico | Plan sin clave solo para uso no comercial con condiciones |
| OpenStreetMap Overpass | `none_limited` | P2 | [Enlace](https://overpass-api.de/api/interpreter) | Objetos geográficos OSM | Respeto a límites públicos; no usar búsquedas pesadas por defecto |
| OpenStreetMap Nominatim | `none_limited` | P2 | [Enlace](https://nominatim.openstreetmap.org/search) | Geocodificación y nombres de lugares | Servidor público máximo 1 solicitud/segundo; cachear |

## Derecho y regulación

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| Federal Register API | `none` | P1 | [Enlace](https://www.federalregister.gov/api/v1/documents.json) | Normas, propuestas y avisos federales de EEUU | Verificar contra edición oficial para efectos jurídicos |
| UK Legislation API | `none` | P1 | [Enlace](https://www.legislation.gov.uk/openapi) | Leyes británicas, cambios y notas | Verificar entrada en vigor y jurisdicción |
| EU Publications Office CELLAR SPARQL | `none_limited` | P1 | [Enlace](https://publications.europa.eu/webapi/rdf/sparql) | Normativa de UE y relaciones jurídicas | Consultas SPARQL; validación de cambios y textos oficiales |
| ECFR Developer API | `none_expected` | P1 | [Enlace](https://www.ecfr.gov/developers/documentation/api/v1) | Código de regulaciones federales estadounidenses | Comprobar versiones de texto y vigencia |

## Software y tecnología

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| GitHub REST Public | `none_limited` | P1 | [Enlace](https://api.github.com/search/repositories) | Repositorios públicos, proyectos de software | Bajo límite anónimo de búsqueda; no evalúa calidad automáticamente |
| Hugging Face Hub Public | `none_limited` | P1 | [Enlace](https://huggingface.co/api/models) | Modelos y datasets de IA de libre acceso | Model cards y licencias; no equivale a calidad de investigación |
| PyPI JSON API | `none` | P1 | [Enlace](https://pypi.org/pypi/requests/json) | Metadatos y versiones de paquetes Python | No usar versión nueva como evidencia de seguridad |
| npm Registry | `none` | P1 | [Enlace](https://registry.npmjs.org/react) | Paquetes JavaScript | Datos de editor, dependencias y versiones |
| Crates.io API | `none_limited` | P2 | [Enlace](https://crates.io/api/v1/crates) | Ecosistema Rust | Incluir User-Agent y respetar política de uso |
| OSV.dev API | `none` | P1 | [Enlace](https://api.osv.dev/v1/query) | Vulnerabilidades de dependencias open source | Consulta principalmente por paquete/versión/commit |
| NIST NVD CVE API | `none_limited` | P1 | [Enlace](https://services.nvd.nist.gov/rest/json/cves/2.0) | CVE y evaluación de vulnerabilidades | Límites anónimos estrictos; programar cache incremental |
| Stack Exchange API | `none_limited` | P2 | [Enlace](https://api.stackexchange.com/2.3/search/advanced) | Problemas técnicos y soluciones comunitarias | No es fuente científica revisada por pares |

## Humanidades y cultura

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| Open Library Search | `none_limited` | P2 | [Enlace](https://openlibrary.org/search.json) | Libros, ediciones y autores | Catalogación de origen mixto |
| Library of Congress JSON | `none_limited` | P2 | [Enlace](https://www.loc.gov/books/?fo=json) | Colecciones históricas, libros y documentos | No implica permiso de redistribución |
| The Met Collection API | `none` | P2 | [Enlace](https://collectionapi.metmuseum.org/public/collection/v1/search) | Historia del arte, obras y colecciones | Recursos y derechos por obra |

## Actualidad contextual

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| GDELT 2.0 DOC | `none_limited` | P2 | [Enlace](https://api.gdeltproject.org/api/v2/doc/doc) | Noticias mundiales y búsqueda mediática | No es evidencia científica ni verifica veracidad de noticias |

## Patentes: no anónima

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| PatentsView Search API | `key_required` | OFF | [Enlace](https://search.patentsview.org/api/v1) | Búsqueda de patentes EEUU | Requiere clave; altas nuevas pueden estar suspendidas |
| USPTO Open Data Portal API | `key_required` | OFF | [Enlace](https://data.uspto.gov/apis/getting-started) | Expedientes y patentes estadounidenses | Clave requerida; alternativa descarga bulk sin clave |
| EPO Open Patent Services | `key_required` | OFF | [Enlace](https://developers.epo.org/) | Patentes europeas | Registro y credenciales, excluir del modo anónimo |

## Identificadores: no anónima

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| ORCID Public API registrada | `key_required` | OFF | [Enlace](https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/) | Identidad y obras de investigadores | OAuth Client ID y secreto; usar datos OpenAlex/ROR mientras tanto |

## Estadística: no anónima

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| FRED API | `key_required` | OFF | [Enlace](https://fred.stlouisfed.org/docs/api/fred/) | Series económicas Reserva Federal EEUU | Requiere clave; usar World Bank/OECD/IMF como alternativa |

## Bibliografía: no anónima

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| CORE API | `key_required` | OFF | [Enlace](https://core.ac.uk/services/api) | Texto y metadatos académicos | Requiere clave; sustituir por Europe PMC y repositorios |
| Scopus API | `key_required` | OFF | [Enlace](https://dev.elsevier.com/) | Bibliometría propietaria | Necesita API key y condiciones de licencia |
| Web of Science API | `key_required` | OFF | [Enlace](https://developer.clarivate.com/) | Citaciones e indexación propietaria | Requiere credenciales |

## Sin API pública oficial

| Fuente | Acceso | Prioridad | Documentación / API | Uso | Precaución |
|---|---|---|---|---|---|
| Google Scholar | `no_official_api` | OFF | [Enlace](https://scholar.google.com/) | Búsqueda bibliográfica web | No usar scraping automatizado como API oficial |

## Arquitectura recomendada

1. Clasificar pregunta y decidir investigación científica, búsqueda bibliográfica, consulta de datos, exploración factual o mezcla.
2. Generar consultas multilingües/MeSH/sinónimos y restricciones de época, lugar y tipo de diseño.
3. Lanzar una primera ola de entre 3 y 6 conectores de mayor cobertura y pertinencia; segundo lote solo para evidencia faltante.
4. Ejecutar peticiones con timeouts, concurrencia acotada, caché, token buckets independientes por dominio y respeto a Retry-After.
5. Unificar DOI, PMID, PMCID, arXiv, NCT y URL canónica; verificar metadatos con Crossref / DataCite.
6. Descargar texto estructurado solo por vías y licencias autorizadas; extraer método, población, resultados, medidas y limitaciones.
7. Aplicar evaluación de calidad específica del dominio (medicina: RoB 2/ROBINS-I, GRADE por desenlace cuando proceda; estadísticas: origen y métodos).
8. Vincular cada afirmación a una evidencia identificable, detectar contradicciones, retractaciones y versiones.
9. Renderizar respuesta progresiva con estado de la investigación, tabla de evidencia, citas y conclusiones calificadas.
10. Mantener telemetría de p50/p95, tasas de éxito, relevancia NDCG@10, exactitud de citas y cobertura por disciplina.

## Seguridad y límites

No enviar datos personales o de pacientes a motores públicos, no saltar CAPTCHA o cuotas, no realizar scraping de sitios sin API, no asumir que preprint = revisión por pares, respetar licencias y términos.

## Estado de integración

Catálogo investigado, **no desplegado** en el repositorio PHOENIX. Cada conector debe pasar primero pruebas reales de disponibilidad, esquema, paginación, autenticación y límites.