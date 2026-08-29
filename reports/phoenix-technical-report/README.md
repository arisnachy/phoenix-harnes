# Informe técnico de PHOENIX

English | [中文](README.zh.md)

Este directorio contiene la fuente HTML y el PDF regenerable del informe “PHOENIX — Uso, arquitectura y controles operativos”. El documento describe el checkout inspeccionado el 28 de agosto de 2026 para una audiencia técnica.

## Regenerar

Desde la raíz del repositorio:

```powershell
node reports/phoenix-technical-report/render-report.mjs
node reports/phoenix-technical-report/verify-report.mjs
```

La fuente está en `report.html` y la salida en `phoenix-technical-report.pdf`. El render usa Playwright y no requiere credenciales ni una conexión a Gmail.

## Evidencia

Las afirmaciones se contrastan con `README.md`, `docs/architecture.md`, `docs/development.md`, `docs/phoenix-windows.md`, `SECURITY.md`, `AGENTS.md` y `package.json`. El informe distingue capacidades documentadas, límites condicionados y estado de desarrollo; no sustituye la documentación normativa del producto.
