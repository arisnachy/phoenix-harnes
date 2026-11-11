/** Human-readable ESPN Dominican pages for source discovery, NOT fetched evidence. */
export const ESPN_NBA_PUBLIC_PAGES = Object.freeze([
  {kind:'injuries',name:'ESPN RD · Lesiones NBA',
    url:'https://www.espn.com.do/basquetbol/nba/lesiones'},
  {kind:'statistics',name:'ESPN RD · Estadísticas NBA',
    url:'https://www.espn.com.do/basquetbol/nba/estadisticas'},
  {kind:'schedule',name:'ESPN RD · Calendario NBA',
    url:'https://www.espn.com.do/basquetbol/nba/calendario'},
  {kind:'players',name:'ESPN RD · Jugadores NBA',
    url:'https://www.espn.com.do/basquetbol/nba/jugadores'},
  {kind:'celtics-roster-example',name:'ESPN RD · Plantilla Boston Celtics (ejemplo)',
    url:'https://www.espn.com.do/basquetbol/nba/equipo/plantel/_/nombre/bos/boston-celtics'},
].map(page=>({...page,status:'reference-only' as const})))

export const ESPN_NBA_API_STARTING_POINTS=Object.freeze([
  {kind:'injuries',pattern:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'},
  {kind:'scoreboard',pattern:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD'},
  {kind:'team-roster',pattern:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{verifiedTeamId}/roster'},
  {kind:'leaders',pattern:'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete'},
  {kind:'athlete-overview',pattern:'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{verifiedAthleteId}/overview'},
].map(page=>({...page,status:'endpoint-template' as const})))
