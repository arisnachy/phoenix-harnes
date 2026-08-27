# Experimentos HARDNESS

## 2026-08-27 · calendar_invite no enumerado

- Necesidad: `calendar_invite`, entrada `event`, salida `text/calendar`.
- Estado inicial: `unknown`; no existía ningún kind registrado.
- Tras registrar fixture local en estado `experimental`: `missing`; el resolver no acepta capabilities no verificadas.
- Evidencia: `evidence:calendar-invite`, outcome `passed`, artifact `artifact:invite.ics`.
- Tras promoción explícita: `have`, capability `fixture:calendar-invite`.
- Tras snapshot/restore en un segundo servicio: `have` sin repetir la verificación.
- Comando: `pnpm exec vitest run packages/hardness/hardness/tests/unknown-need.e2e.spec.ts`.
- Resultado: 1 test pasado.
- Limitación: no se implementó adquisición externa; el fixture representa BUILD local determinista.
