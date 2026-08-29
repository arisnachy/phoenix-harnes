# Landing promocional de PHOENIX

Landing estática y dinámica servida por VitePress en `/phoenix/index.html`. La superficie está separada del shell operativo de `apps/web` y no requiere credenciales ni dependencias externas.

## Archivos

- `index.html`: contenido semántico, navegación, demo y CTA.
- `styles.css`: sistema visual Local Clarity y layout responsive.
- `main.js`: estados del demo, menú móvil, copiado de comando y revelado accesible.

## Verificar

Desde la raíz del repositorio:

```powershell
pnpm --dir website run build
pnpm --dir website run dev
```

Abrir `http://127.0.0.1:5173/phoenix/index.html`.

## Claims y fuentes

La página usa afirmaciones respaldadas por `README.md`, `docs/architecture.md`, `docs/phoenix-windows.md` y `SECURITY.md`. PHOENIX se presenta como un producto en desarrollo activo; no se declaran backup cloud disponible, release firmado, métricas de adopción ni garantías absolutas.
