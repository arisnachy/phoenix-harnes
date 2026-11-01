# PHOENIX Senses — capacidades digitales

English | [中文](phoenix-senses.es.zh.md)

PHOENIX Senses conecta audio, imagen y voz con evidencias y permisos explícitos. No incluye tacto, olfato, gusto ni sensores físicos.

## Oído

- `phoenix_audio_status`: comprueba la disponibilidad de altavoces y micrófono sin grabar.
- `phoenix_audio_listen`: captura entre 3 y 12 segundos de `output` o `microphone`. El primer diálogo permite autorizar solo la muestra o conceder 15 minutos para la fuente y conversación actuales; no hay escucha permanente.
- `phoenix_audio_file_listen`: procesa WAV, MP3, M4A, OGG, FLAC, WebM y MP4 solo desde `PHOENIX_AUDIO_ALLOWED_DIRS`. Límite: 32 MiB. Nunca explora el disco.
- `video_media_inspect` y `youtube_video_listen`: rutas existentes para videos autorizados del navegador. El audio protegido puede estar bloqueado.
- Los archivos nativos temporales se eliminan después de transcribir y los residuos antiguos se depuran. Los archivos de origen no se modifican.

## Visión y autoconocimiento

- Desktop Live, Computer Use y MiniBrowser ofrecen vistas autorizadas. Una acción de Computer Use sin ventana seleccionada abre el visor nativo del escritorio virtual completo; con una ventana seleccionada se mantiene esa ventana, sin usar el selector de compartir de Chrome.
- `phoenix_senses_status` comprueba los visores y dispositivos disponibles, pero no supone haber capturado una imagen ni haber escuchado sonido.
- El MiniBrowser de Windows incluye una franja inferior **Kira · estado**, **Inspeccionar** y **Depurar**. La primera acción obtiene texto visible, campos no secretos, botones y metadatos de videos/audio. La segunda abre DevTools de Edge para diagnóstico visual. El agente usa la tubería local autenticada; los scripts de páginas web no pueden llamar a la automatización.
- `pageReady`, `lastNavigationError` y `lastInspectedAt` distinguen carga exitosa, error y observación real. Una página `about:blank` nunca cuenta como observación.
- Ante un video de YouTube sin subtítulos disponibles, Kira debe probar sus herramientas de video y, si el usuario reproduce el video en Windows, puede solicitar una captura WASAPI de salida **con aprobación inicial visible**. La autorización temporal de esa conversación evita confirmar cada fragmento mientras siga vigente. La transcripción de un clip de 3–12 segundos nunca equivale al contenido completo del video.
- La visión real requiere un fotograma o captura del propio Desktop Live o Computer. El video de navegador depende de las herramientas existentes.
- `phoenix_voice_status` y `phoenix_voice_speak` mantienen la salida de voz. Un acuse del proveedor no demuestra que se haya escuchado por altavoces.

## Instalación y permisos

1. Actualizar el Host y `Phoenix.exe` en el mismo usuario de Windows. Se necesita .NET 8 y la dependencia `NAudio.Wasapi`.
2. Configurar `PHOENIX_AUDIO_ALLOWED_DIRS` con directorios concretos separados por punto y coma; no autorizar indiscriminadamente toda la unidad.
3. Instalar `uv` para disponer del motor local `faster-whisper`, que usa CPU INT8 y descarga el modelo cuando es necesario.
4. Preguntar «Kira, revisa tus sentidos», «Kira, escucha los altavoces» o «Kira, observa esta aplicación» y aprobar la fuente exacta una vez, si se desea permitir nuevas muestras de esa fuente durante 15 minutos. El indicador de la ventana muestra cuándo está grabando.

## Límites verificables

- La captura usa el dispositivo multimedia predeterminado y no aísla cada proceso.
- La transcripción reconoce voz; no identifica de modo fiable todos los sonidos ambientales ni a todos los hablantes.
- El audio se captura en fragmentos breves y autorizados. La vista nativa del escritorio puede actualizarse mientras el visor esté abierto y la sesión tenga autoridad de Computer Use; puede ocultarse o pausarse desde la barra de Desktop Live. Sin Host nativo, la web sigue sujeta al selector de Chrome.
- Una herramienta registrada en el código no equivale a estar disponible en la sesión activa; su estado debe verificarse.
