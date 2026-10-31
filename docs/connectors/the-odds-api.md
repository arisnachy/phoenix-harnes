# The Odds API v4 · Conector con credenciales de PHOENIX

La integración `The Odds API` de la sección **Ajustes → Conectores** configura
el proveedor oficial **https://the-odds-api.com/**, cuya API es
`https://api.the-odds-api.com/v4/`. **No es** el proveedor distinto
`TheOddsAPI` (`api.theoddsapi.com`), que utiliza su propia clave.

## Configuración

1. Crea una cuenta en https://the-odds-api.com/ y solicita tu API key.
2. Abre **PHOENIX → Ajustes → Conectores**, busca **The Odds API**.
3. Pulsa **Añadir API key**, pega la clave en el campo de tipo contraseña y
   pulsa **Guardar en el vault y verificar**.
4. El Host de PHOENIX prueba la clave en el endpoint
   `GET https://api.the-odds-api.com/v4/sports/?apiKey=...`.
   Según la documentación de The Odds API, este endpoint **no consume
   créditos de cuotas**. No transmite la clave a Kira ni a la UI de estado.
5. Se mostrará **Conectada · API key verificada** y, si el proveedor lo publica,
   el número de créditos usados y restantes. Los estados **Clave guardada ·
   sin verificación** y **Clave rechazada** son distintos.
6. Kira resuelve `THE_ODDS_API_KEY` desde el almacén de credenciales en
   **cada operación**. No necesita reiniciar PHOENIX después de cambiarla.
   Si la clave no está en el vault, la variable `THE_ODDS_API_KEY` del
   entorno continúa siendo una opción de compatibilidad.
7. Para sustituir una clave, usa **Cambiar API key**. Una clave rechazada
   no sustituye la anterior. Para eliminar una clave del vault, usa
   **Desconectar**; no modifica variables de entorno del sistema.

## Cómo probar con Kira

«Kira, consulta `sports_chat_sources_health` y luego
`sports_chat_odds` con `sourcePolicy=all`, `sportKey=basketball_nba`
y `markets=h2h`. Compara The Odds API con ESPN, indicando la casa,
mercado, hora publicada y origen. Si el proveedor no devuelve datos o no
quedan créditos, informa el estado sin inventar cuotas ni hacer un ticket
apostado».

Para tickets que requieren precios, el backend vuelve a resolver la clave
desde el vault y solo emplea cuotas genuinas que satisfagan sus filtros de
vigencia, fecha, mercado y casa.

## Limitaciones y seguridad

- Una clave verificada demuestra acceso al catálogo de deportes, **no**
  garantiza que tu suscripción cubra todos los mercados, históricos o fechas.
- La documentación oficial calcula el coste de `/odds` por número de mercados
  y regiones. La verificación de la clave no consume créditos, pero
  las consultas de cuotas sí pueden hacerlo.
- Los valores secretos nunca se guardan en Settings JSON, Git, capturas,
  respuestas de diagnóstico ni atributos de UI.
- Ante 401/403, el Host rechaza una nueva clave sin reemplazar la anterior;
  ante caída de red, puede conservarla con el estado «sin verificar».
- Los cupones preparados por Kira no equivalen a apuestas aceptadas;
  PHOENIX no ejecuta pagos por instalar esta conexión.

Referencia: https://the-odds-api.com/liveapi/guides/v4/
