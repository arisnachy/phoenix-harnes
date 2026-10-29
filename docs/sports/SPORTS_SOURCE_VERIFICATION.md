# PHOENIX — verificación honesta de fuentes deportivas

La investigación de partidos de ESPN, la disponibilidad del **comando** de una fuente, la presencia de un **archivo histórico** y la obtención de **cuotas recientes de una casa** son cuatro cosas diferentes. La herramienta de chat `sports_chat_sources_health` informa de la configuración sin exponer secretos; no inventa precios.

## Tres repositorios acordados

| Repositorio | Función | Estado mínimo para usarlo |
| --- | --- | --- |
| [jordantete/OddsHarvester](https://github.com/jordantete/OddsHarvester) | Consulta previa de cuotas de OddsPortal y mercados específicos | Instalar CLI y Playwright Chromium, habilitar explícitamente y comprobar que devuelve filas con casa, fecha y precio |
| [flancast90/sportsbookreview-scraper](https://github.com/flancast90/sportsbookreview-scraper) | Historical odds backtesting NFL/NBA/NHL/MLB | Exportar `sportsbookreview-<sport>.json` y definir `PHOENIX_SPORTS_HISTORY_DIR`; nunca cotizar hoy |
| [ArnavSaraogi/mlb-odds-scraper](https://github.com/ArnavSaraogi/mlb-odds-scraper) | Datos históricos MLB de SportsbookReview | Exportar `mlb-odds.json` a la misma ruta; nunca cotizar hoy |

Los dos archivos históricos **no** son un feed de precios de hoy. PHOENIX no descarga silenciosamente los datos ni omite límites de acceso al sitio. El usuario conserva la decisión de instalar/habilitar scraping.

## Windows: instalar la CLI opcional en un entorno aislado

En la carpeta local del proyecto PHOENIX:

```powershell
py -m venv .phoenix-odds
.\.phoenix-odds\Scripts\python.exe -m pip install --upgrade pip
.\.phoenix-odds\Scripts\python.exe -m pip install oddsharvester
.\.phoenix-odds\Scripts\python.exe -m playwright install chromium
.\.phoenix-odds\Scripts\oddsharvester.exe --help
```

Una vez comprobadas las condiciones del proveedor y su acceso, lanzar PHOENIX **desde la misma consola**:

```powershell
$env:PHOENIX_SPORTS_ODDSHARVESTER_BIN = (Resolve-Path '.\.phoenix-odds\Scripts\oddsharvester.exe').Path
$env:PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED = '1'
pnpm phoenix
```

**Primera verificación real, antes de confiar en un ticket:**

```powershell
.\.phoenix-odds\Scripts\oddsharvester.exe upcoming -s football -d 20261029 -m 1x2 --headless -f json -o .\sports-odds-test.json
```

Cambiar `-d` a la fecha futura deseada (formato AAAAMMDD). Ese comando contacta OddsPortal: puede no devolver precios por región, mercado, anti-bot, ausencia de encuentros o restricciones del proveedor. Los datos del archivo **solo** son válidos si registran casa, mercado, precio y timestamp actualizado. Nunca usar `--preview-only` para cotizar un ticket de una misma casa, ya que no da necesariamente precios por operador.

## Cómo comprobarlo en el chat

1. Pedir a Kira: «Ejecuta `sports_chat_sources_health` y enséñame el estado de todos los proveedores».
2. Pedir `sports_chat_odds_keyless` con deporte y mercado específicos para comprobar **cuotas reales** (si está habilitado).
3. Ejecutar `sports_chat_ticket_evidence_priced_auto` con `count=5`. Inspeccionar `sourceAudit`, `quotedLegs`, `approvedLegs`, `multisportSatisfied`. Si `approvedLegs=0`, la tarjeta es una hipótesis/agenda sin apuesta cotizada completa, incluso si muestra cuatro partidos.
4. Para 1X/X2: aceptar solo filas del mercado **double_chance** verificadas de la misma casa; no convertir precios 1X2 en doble oportunidad.

No confundir la respuesta disponible de un feed médico ESPN con lesión/portero confirmado. Rendimiento histórico, muestra de cinco y margen son **evidencia descriptiva**, no modelo calibrado ni garantía de rentabilidad. Las cuotas cambian, y los mercados pueden cerrarse.

## Diagnóstico práctico para compartir

Enviar la salida de Kira de `sports_chat_sources_health`, el bloque `sourceAudit` (sin secretos), los fundamentos del ticket y la tarjeta visible. Ninguna clave de API debe compartirse.
