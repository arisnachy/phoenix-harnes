# Phoenix Comic Studio — memoria editorial y producción de cómics

Español | [中文](phoenix-comic-studio.zh.md)

Comic Studio añade a Phoenix una habilidad creativa reutilizable; no cambia el arnés universal ni obliga a usar el motor de videojuegos. Conserva la serie, personajes, referencias y línea temporal entre conversaciones, proveedores y reinicios mediante JSON y recursos visuales en `~/.dsh/comic-studio/series/<id>/`. Configurable con `PHOENIX_COMICS_HOME`. Su integración incorpora el motor local invocable por Kira mediante la habilidad `phoenix-comic-studio` y el publicador nativo `phoenix_comic` dentro del chat, sin una pestaña independiente ni MiniBrowser.

## Comandos

```bash
node scripts/phoenix-comic-studio.mjs init "Guardianes de Orión" guardianes-orion
node scripts/phoenix-comic-studio.mjs world guardianes-orion reglas.json
node scripts/phoenix-comic-studio.mjs asset guardianes-orion hero-front hero-front.png
node scripts/phoenix-comic-studio.mjs character guardianes-orion personaje.json
node scripts/phoenix-comic-studio.mjs location guardianes-orion lugar.json
node scripts/phoenix-comic-studio.mjs issue guardianes-orion entrega.json
node scripts/phoenix-comic-studio.mjs art-brief guardianes-orion numero-uno
node scripts/phoenix-comic-studio.mjs asset guardianes-orion art-panel-1 panel-1.png
node scripts/phoenix-comic-studio.mjs page guardianes-orion numero-uno pagina.json
node scripts/phoenix-comic-studio.mjs audit guardianes-orion numero-uno
node scripts/phoenix-comic-studio.mjs render guardianes-orion numero-uno --pdf --cbz
node --test scripts/phoenix-comic-studio.test.mjs
```

`render` siempre guarda un lector `comic.html` real, con ilustración raster embebida y texto maquetado de manera independiente. `--pdf` imprime a PDF real mediante Chrome/Chromium; `--cbz` rasteriza cada página a PNG mediante Chrome/Chromium y las empaqueta con `ComicInfo.xml`. Chrome debe estar instalado y funcionar en el entorno; la variable opcional `PHOENIX_COMICS_CHROME` admite su ruta. Si el navegador falla, el HTML queda disponible y no se anuncia PDF/CBZ exitoso. `--draft` permite vista previa de una página con recursos faltantes y marca el archivo como borrador; sin esa marca un recurso o estado causal incorrecto bloquea la exportación.

## Estructura de las entradas

`reglas.json` es una matriz de reglas inmutables en la primera versión, por ejemplo `["Los portales abren solo de noche"]`.

`personaje.json`:

```json
{"id":"venga","name":"Venga","description":"Protagonista","visualSignature":"Pelo plateado, ojo izquierdo verde, chaqueta escarlata y cicatriz bajo el ojo derecho","voice":"Directa","baseline":{"costume":"scarlet","injury":"none","location":"tower"},"references":{"front":"hero-front","profile":"hero-profile"}}
```

El `asset` de cada referencia se importa ANTES de crear el personaje, y el mismo identificador no se puede sustituir por otros píxeles. Para rediseñar un personaje se crea una referencia con otro ID, una nueva versión editorial explícita y se revisan los paneles afectados. La ficha de personaje no garantiza consistencia visual del generador: sirve como canon para condicionamiento y comparación posteriores.

`lugar.json`: `{"id":"tower","name":"La torre","description":"Azotea con antenas","referenceAsset":"tower-front"}`.

`entrega.json`: `{"id":"numero-uno","number":1,"title":"El portal","synopsis":"La primera grieta entre mundos"}`.

`pagina.json`:

```json
{
  "number":1,
  "rows":[2,1],
  "panels":[
    {"id":"n1-p1-a","asset":"art-panel-1","location":"tower","action":"Venga observa el cielo","visualPrompt":"Plano americano, noche, abrigo rojo, mismo rostro aprobado","characters":[{"id":"venga","pose":"de pie","costume":"scarlet","expression":"alerta"}],"dialogue":[{"speaker":"venga","text":"Hay algo al otro lado.","type":"speech"}],"changes":[]},
    {"id":"n1-p1-b","asset":"art-panel-2","location":"tower","action":"El portal parpadea","characters":[],"dialogue":[{"speaker":"narrator","text":"Medianoche.","type":"caption"}],"changes":[]},
    {"id":"n1-p1-c","asset":"art-panel-3","location":"tower","action":"Venga toca el borde del portal","characters":[{"id":"venga","pose":"brazo extendido","costume":"scarlet","expression":"temor"}],"dialogue":[],"changes":[{"subject":"venga","field":"injury","before":"none","after":"burn","reason":"La energía le produjo una quemadura visible"}]}
  ]
}
```

`rows` enumera la cantidad de viñetas por fila (hasta cuatro); la suma debe coincidir exactamente con `panels`. Cada personaje debe estar definido; `changes` se aplican por número de entrega, página y viñeta. La auditoría rechaza transiciones inconsistentes, saltos de numeración, IDs repetidos, referencias inexistentes, imágenes alteradas y páginas vacías. Las escenas sin imagen no se publican por defecto.

## Flujo visual de Kira

1. Interpretar la intención natural («crea un cómic de…», «continúa el número siguiente»), generar biblia, reglas, reparto, lugares, secuencia y entregas, y recuperar proyecto existente antes de crear otra serie.
2. Importar referencias aprobadas de frente, perfil y tres cuartos. Mantener constantes rostro, silueta, paleta, accesorios y escenarios. Una nueva imagen requiere revisión, no se considera automáticamente el mismo personaje.
3. Generar las ilustraciones con una capacidad de imagen REAL del proveedor conectado o una herramienta instalada, pasando las referencias correspondientes y el brief de `art-brief`. No devolver solo el brief como si fuera el cómic y no inventar archivos. Si la herramienta no admite condicionamiento por imagen, comunicar la limitación y reforzar revisión comparativa.
4. Escribir cada `pagina.json`, importar cada panel, auditar y maquetar. Conservar paneles aprobados al corregir otros. Revisar texto, dirección de lectura y tamaños de globos en el render final.
5. Abrir y revisar visualmente las páginas exportadas, reconciliar diferencias con el canon, y confirmar licencias y derechos antes de publicar o cobrar. Añadir portadas ilustradas, créditos y preparación de sangrado según la imprenta real; la primera versión no valida sangrado, ISBN, accesibilidad final ni la calidad artística visual.
6. Conservar `project.json` y `assets/` fuera del runtime temporal de Phoenix. Las revisiones cambian el número de proyecto; un `release.json` enlaza huellas de los archivos generados. No usar `release.json` como prueba de publicación externa.

## Garantías y límites

La biblioteca conserva canon de texto, referencias por ID y hashes SHA-256 de imágenes, orden de viñetas y estados causales entre números. No incorpora por sí sola modelo de imagen, reconocimiento facial, embeddings visuales, generación automática de prompts a imágenes, evaluación perceptual, licencias externas o publicación a tiendas. Su auditoría declara `visualConsistencyVerified:false`, `narrativeQualityVerified:false`, `rightsVerified:false` y `humanArtReviewRequired:true`; el usuario no debe recibir la impresión de que la igualdad de personajes, la originalidad o la impresión profesional están certificadas solo por aprobar validaciones estructurales.
## Publicación directa dentro del chat

Después de generar las ilustraciones auténticas y componer la edición con `render`, Kira llama a `phoenix_comic` usando el ID de serie y entrega. El Host reabre `release.json`, verifica `draft:false`, `structurallyValid:true`, la ruta y el SHA-256 de `comic.html`, comprueba al menos una página con viñetas que contengan datos reales PNG/JPEG/WEBP y emite `application/vnd.phoenix.comic+html`. El cliente lo presenta como HTML estático aislado, con ajuste responsivo; nunca como navegación al propio Phoenix. El recibo confirma publicación del artefacto y estructura de las imágenes, no identidad facial, calidad artística, precisión narrativa o publicación comercial. `file_path` dentro del workspace e `html` inline son alternativas para trabajos no registrados. Una herramienta ausente o una falla de generación debe comunicarse como bloqueo; no se puede declarar un cómic publicado basándose en texto de Kira o en el estado del navegador.
