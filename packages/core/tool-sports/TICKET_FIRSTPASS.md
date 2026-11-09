# PHOENIX · Selección diaria y cobertura segura de datos

**Primer paso.** PHOENIX explora todas las ligas ESPN admitidas con actividad futura para el día local, contrasta dos particiones UTC y prioriza diversidad; al investigar, no interrumpe después de hallar cinco favoritos, sino que compara un pool mayor de candidatos.

**Calidad.** Los candidatos fuertes requieren cinco resultados distintos por equipo (NFL: tres), señal descriptiva coherente y revisión especializada posterior. Si una muestra suficiente arroja resultados modestos/contradictorios, puede aparecer como hipótesis CONDICIONAL, no como selección aprobada. En ausencia de cinco eventos auténticos, se conserva un borrador incompleto; nunca se inventan partidos.

**Probabilidad por pata.** El motor exploratorio de forma reciente entrega una estimación individual si dispone de datos. Se etiqueta 'exploratory-recent-form' y se informa que no está calibrada. Con mercado de dos lados actualizado y mismo bookmaker, 'bookmaker-market-no-vig' se etiqueta como participación implícita del mercado, no como certeza predictiva. No presentar EV, rentabilidad ni probabilidad conjunta como ventajas demostradas.

**Fuentes.** El inventario `sports-research-coverage.ts` mapea por deporte y paso las fuentes ESPN, NHL Web, MLB StatsAPI, TheSportsDB, API-Sports, nflverse, Big Balls, NFLMeta, Sportmonks y conectores de cuotas. `integrated` / `planned` / `official-followup` son distintos: ninguna clave garantiza respuesta o licencia.

**Credenciales.** `sports_chat_research_provider_status` informa qué claves opcionales existen y si el almacén permite escribir. Las claves se resuelven por operación y no se muestran al modelo. Desde la interfaz de chat de PHOENIX se utiliza el comando humano `/secret set PHOENIX_API_FOOTBALL_KEY VALOR` o los correspondientes nombres de API-Hockey, API-NFL, Big Balls, NFLMeta, Sportmonks y casas. El Host lo intercepta sin registrar entrada para el agente. Nunca pegar claves como mensajes dirigidos a Kira, ni ponerlas en capturas.

**Límite actual.** La tarjeta Secure Ask para contraseñas de páginas no se ha convertido automáticamente en un formulario de claves API. Esta entrega usa el mecanismo humano de bóveda ya existente. Integrar un selector nativo de conectores y botón 'Añadir clave' sin exponer el valor al modelo es una mejora de interfaz separada.