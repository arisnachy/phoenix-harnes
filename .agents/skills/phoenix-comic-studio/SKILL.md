---
name: phoenix-comic-studio
description: Crear, continuar, auditar y exportar cómics, manga, webtoons y novelas gráficas con personajes consistentes, canon persistente y secuencias narrativas.
whenToUse: El usuario solicita crear un cómic, historieta, novela gráfica, manga, webtoon, capítulo, viñeta, personaje serializado o continuar una saga ilustrada.
---

# Phoenix Comic Studio — coordinación de Kira

**Integración visual opcional:** usa phoenix-design-intelligence para composición o retoque compatibles con Canva, conservando biblia de personajes, continuidad y viñetas irregulares en Comic Studio. No des por entregado un PDF por haber creado una página de Canva.

**Intención natural.** Ante «crea un cómic de…» o «continúa mi serie», detecta la necesidad y ejecuta el motor sin pedir nombres de scripts, archivos, modelos o parámetros técnicos. Reutiliza las capacidades universales de orquestación, generación de imágenes, almacenamiento, memoria y publicación. No impongas una historia predeterminada. Identifica la serie por su ID existente; no sobrescribas ni reinicies su canon durante una nueva conversación.

**Fuente de verdad:** `node scripts/phoenix-comic-studio.mjs help` y `docs/phoenix-comic-studio.md`. Comienza con `list`, `show` y `audit` para una serie existente. La memoria duradera está bajo `PHOENIX_COMICS_HOME` o `~/.dsh/comic-studio`, no en un chat ni en staging.

**Secuencia de trabajo obligatoria:** biblia del universo → personajes con firmas visuales y referencias frontal/perfil/tres cuartos → lugares → plan de entregas y páginas → brief visual `art-brief` → dibujo con la herramienta de imagen genuinamente disponible, condicionando por imágenes originales aprobadas → importación inmutable de cada ilustración → diálogos como capas editables → auditoría → exportación HTML/PDF/CBZ → revisión visual de cada página. Continuar del checkpoint si se interrumpe. Conservar las páginas y referencias ya revisadas; ante un fallo concreto reparar la viñeta específica.

**Calidad visual:** nunca resolver una petición de cómic final con cajas vacías, bocetos genéricos, imágenes de personajes incompatibles o el mismo retrato reutilizado sin cambios de acción. La referencia de identidad no equivale a una comprobación de likeness. Inspeccionar cambios de rostro, pelo, vestuario, accesorios, fondo, escala, manos, anatomía, transiciones, globo/lector y tipografía, comparando con la ficha aprobada. No declarar excelencia automática ni publicar un borrador como terminado. Los activos deben ser creaciones originales o tener licencia y procedencia.

**Memoria narrativa:** cada nueva viñeta registra cambios de heridas, objetos, localizaciones y relaciones mediante `changes` contra un estado anterior. Si aparece contradicción, investigar en el guion y corregirla, no forzar artificialmente el canon. Los personajes y lugares también pueden alimentar libros, animaciones, juegos Godot y productos comerciales, sin trasladar efectos particulares de cómics a todas las misiones Phoenix.

**Entrega en el chat — OBLIGATORIO:** ejecutar `render SERIE ENTREGA` sin abrir MiniBrowser, comprobar el recibo y llamar a la herramienta real `phoenix_comic` con `title`, `series_id` e `issue_id`. Publica un artefacto nativo con las páginas ilustradas, no abre otra pestaña ni la URL de Phoenix. Solo informar «publicado» si la herramienta devolvió `artifactId`, número de páginas y viñetas. Si no existen recursos de imagen auténticos, explicar el bloqueo, NO crear un cómic ficticio ni dar una URL vacía. Está prohibido abrir `127.0.0.1:3080` o `localhost` dentro del navegador para presentar un cómic. La previsualización queda en el chat; la exportación PDF/CBZ real cuando Chrome funciona es independiente. La tienda, anuncios o pagos exigen autorización y recibos aparte. La tienda, anuncios o pagos exigen autorización aparte y recibos verificables. Entregar RESULTADO / EVIDENCIA / RIESGO / ESTADO con ubicaciones reales y pruebas ejecutadas.