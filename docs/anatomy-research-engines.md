# PHOENIX Anatomía — motores ejecutables de investigación

Este adaptador no convierte ECG ni GLB automáticamente en modelos fisiológicos. Exige archivos de configuración previamente preparados y un resultado que nunca se registra como diagnóstico.

- `svzerod`: integración ejecutable de **svZeroDSolver** (SimVascular 0D) con una red vascular JSON y salida CSV; el instalador opcional crea el ejecutable en el entorno aislado si existen ruedas compatibles.
- `opencarp`: ejecuta `openCARP -par CONFIG -simID OUTPUT` en Linux o en **WSL2 Ubuntu 24.04** (Windows); utiliza `wslpath` para convertir rutas locales. Debe existir openCARP real y un archivo `.par` con malla y parámetros apropiados.
- `simvascular`: permite arrancar la aplicación gráfica desde una instalación verificada en WSL. El cálculo CFD 3D requiere construir malla, condiciones de contorno y trabajo del solver específico; no se infiere a partir de un GLB.

Ejecutar: `node scripts/phoenix-anatomy-simulation.mjs doctor`. Para una simulación 0D preparada: `node scripts/phoenix-anatomy-simulation.mjs run --engine svzerod --input config.json --output result.csv --research-only`. Para openCARP: sustituye `--engine opencarp` y pasa `config.par` y una salida nueva. Para la aplicación gráfica: `PHOENIX_SIMVASCULAR_BIN=/usr/local/sv/simvascular/YYYY-MM-DD/simvascular node scripts/phoenix-anatomy-simulation.mjs launch --engine simvascular`.

En Windows se requieren WSL2, distribución Ubuntu y los ejecutables instalados conforme a los fabricantes. No se instalan WSL ni paquetes Linux con privilegios de administrador sin una autorización explícita del operador. El proceso no registra datos del paciente en el historial de chat, no sobrescribe una simulación anterior y no certifica conformidad diagnóstica.
