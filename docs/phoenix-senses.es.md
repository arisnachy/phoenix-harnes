# PHOENIX Senses — capacidades digitales (español)

Esta fase de PHOENIX implementa percepción digital con evidencia y permisos explícitos. **No incluye tacto, olfato, gusto ni sensores físicos**.

## Oído
- `phoenix_audio_status`: verifica dispositivos de salida y micrófono predeterminados de Windows. No graba.
- `phoenix_audio_listen`: captura exclusivamente 3–12 segundos de la fuente solicitada (`source: output` o `source: microphone`), con un diálogo nativo de aceptación **en cada llamada** y transcripción local con faster-whisper/uv.
- `phoenix_audio_file_listen`: transcribe un archivo WAV, MP3, M4A, OGG, FLAC, WebM o MP4, **solo si su directorio fue aprobado** por el usuario en `PHOENIX_AUDIO_ALLOWED_DIRS` (directorios absolutos separados por `;`). Tamaño máximo: 32 MiB. La herramienta nunca rastrea la unidad para buscar archivos.
- Para videos de pestañas y YouTube existen las herramientas `video_media_inspect` y `youtube_video_listen` del conector Chrome. El usuario debe compartir la pestaña con audio cuando el navegador no permita una captura directa; los sitios con DRM pueden bloquearla.
- Las muestras nativas se eliminan después de transcribirse y se depuran tras 30 minutos si alguna interrupción impide la limpieza. Los archivos originales aprobados se mantienen intactos.

## Visión y autoconocimiento
- Desktop Live, Computer Use y MiniBrowser proporcionan vistas autorizadas del escritorio y páginas.
- `phoenix_senses_status` muestra disponibilidad real del audio, proveedor de voz, estado de los visores nativos y motivos de desconexión. **No es una captura** y nunca debe hacerse pasar por haber visto un fotograma.
- Para *ver realmente* una aplicación se usa `computer` y su captura auténtica, o un fotograma de Desktop Live bajo la conversación propietaria; para analizar video se usan las rutas existentes del conector.
- Voz hablada: `phoenix_voice_status` y `phoenix_voice_speak` conservan los motores instalados, incluidos los proveedores locales compatibles. Un acuse de síntesis no demuestra que los altavoces se hayan oído.

## Instalación y permisos
1. Instalar o actualizar PHOENIX Windows con sus dependencias; iniciar `Phoenix.exe` y el Host en el mismo usuario de Windows. La aplicación nativa exige `NAudio.Wasapi` y .NET 8.
2. Para audio o notas locales, definir `PHOENIX_AUDIO_ALLOWED_DIRS` antes de iniciar el Host, por ejemplo `C:\\Users\\Usuario\\Music;C:\\Users\\Usuario\\Videos`. No configurar toda la unidad como raíz.
3. Dejar `uv` disponible para instalar la dependencia `faster-whisper` cuando se necesite. El modelo de transcripción se descarga una vez y se ejecuta localmente en CPU INT8.
4. Decir «Kira, revisa tus sentidos», «Kira, escucha los altavoces ocho segundos», «Kira, escucha mi micrófono seis segundos», «Kira, analiza este archivo autorizado» o «Kira, observa la aplicación con Computer Use».

## Límites verificables
- La captura nativa cubre el dispositivo multimedia **predeterminado**, no todas las salidas ni cada proceso de forma aislada. La captura de audio protegido, inaudible o enviado a otro dispositivo puede no ser posible.
- Las transcripciones reconocen voz, pero aún **no clasifican de forma fiable todos los sonidos ambientales** ni identifican hablantes.
- Las capturas son breves y autorizadas, no una escucha constante. Una captura de pantalla tampoco equivale a video continuo.
- Si una herramienta no aparece en el catálogo activo, verificar el perfil y el Host en ejecución; el mero hecho de existir en el repositorio no es una prueba de disponibilidad.
