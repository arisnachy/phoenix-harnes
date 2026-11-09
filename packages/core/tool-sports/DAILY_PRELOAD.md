# PHOENIX · Precarga diaria de investigación deportiva

Antes de generar un boleto, consulta la agenda diaria de NBA/WNBA, NHL, MLB, NFL, Soccer y ATP/WTA con sports_chat_daily_research_cache(statusOnly=true).
Para precargar datos públicos y fuentes optativas con clave usa sports_chat_daily_research_cache(statusOnly=false).

La caché del usuario está en ~/.phoenix/sports-daily-research o PHOENIX_SPORTS_DAILY_RESEARCH_HOME. Retiene hasta siete días de ficheros y un máximo de 10 MB por jornada, pero las respuestas solo se consideran frescas durante minutos u horas, según el tipo. Las cuotas de casas NO se guardan en esta caché.

Fuentes gratuitas en la precarga: ESPN Site, NHL Web API, MLB StatsAPI y TheSportsDB. Fuentes opcionales: API-Football, API-Hockey, API-NFL y Big Balls, con credenciales privadas. Las claves del Host o variables de entorno son PHOENIX_API_FOOTBALL_KEY, PHOENIX_API_HOCKEY_KEY, PHOENIX_API_NFL_KEY y PHOENIX_BIGBALLS_API_KEY.

API-Sports: 100 peticiones diarias publicadas por API, cuota local por defecto de 80/día (20 reservadas), 9/minuto. Configurar PHOENIX_SPORTS_API_SPORTS_DAY_BUDGET entre 1 y 99. Big Balls: presupuesto local conservador independiente; PHOENIX_SPORTS_BIGBALLS_DAY_BUDGET entre 1 y 1000. Los encabezados de cada proveedor y sus restricciones reales prevalecen.

Para habilitar precarga en el arranque y al cambiar de fecha mientras el servicio corre: PHOENIX_SPORTS_DAILY_PRELOAD_AUTO=1. PHOENIX apagado no puede descargar; programar una tarea externa si se requiere preparación antes del inicio del proceso.

Esta memoria mejora rapidez y reutilización, pero no garantiza lesiones verificadas, porteros titulares, alineaciones ni mercados cotizables. El expediente especializado continúa investigando directamente nuevas fuentes y los precios se consultan de nuevo. SportsDataIO Free Trial utiliza datos alterados y no sirve para pronósticos reales; Sportmonks y NFLMeta requieren comprobación individual de licencia, plan y cobertura.