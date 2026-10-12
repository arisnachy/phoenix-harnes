# Retro nativo y PlayStation real

Primero declara target, versión de SDK, formato final, controles y emulador/hardware. Usa código/assets propios o con licencia compatible. Las herramientas de pruebas no aportan automáticamente firmware, BIOS o contenido comercial. No descargues esos contenidos como dependencia oculta.

| Plataforma | SDK de referencia | Salida y validación |
|---|---|---|
| Game Boy/Color | [GBDK-2020](https://github.com/gbdk-2020/gbdk-2020) | `.gb`/`.gbc`, BGB o mGBA |
| NES | [cc65](https://cc65.github.io/) + librería/startup homebrew elegidos | `.nes` con cabecera/mapeador correctos, Mesen |
| SNES | [PVSnesLib](https://github.com/alekmaul/pvsneslib) | `.sfc`, memoria/bancos y prueba en emulador adecuado |
| Mega Drive/Genesis | [SGDK](https://github.com/Stephane-D/SGDK) | `.bin`, VDP/DMA/VRAM/paletas, BlastEm u otro emulador adecuado |
| Master System/Game Gear | [devkitSMS](https://github.com/sverx/devkitSMS) | `.sms`/`.gg`, SDCC + SMSlib y ejemplo del SDK |
| PlayStation 1 | [PSn00bSDK](https://github.com/Lameguy64/PSn00bSDK) | PS-X EXE o `.bin/.cue` según proyecto; DuckStation/PCSX-Redux o hardware |

El toolkit doctor comprueba ejecutables mínimos. La presencia de `sdcc` no verifica SMSlib; MIPS GCC/CMake no verifican librerías PSn00bSDK; cada SDK necesita un ejemplo compilado y el emulador comprobado. Si falta algo, prepara solo esa plataforma y ejecuta su prueba antes de desarrollar. Descarga releases del proyecto autoritativo, fija versión y conserva/verifica sus checksums o firmas publicados; no uses instaladores comunitarios arbitrarios ni desactives la verificación.

## Game Boy: primer build reproducible

Extrae la release GBDK compatible con el SO, configura `GBDK_HOME` y usa su `bin/lcc` (en Windows `lcc.exe`). En el proyecto:

```sh
"$GBDK_HOME/bin/lcc" -o build/game.gb src/main.c
```

Crea `build/` primero; para Color usa las opciones de cartucho/target que documenta esa versión. Antes del juego, compila un ejemplo de la distribución para validar includes/librerías. Tu juego debe inicializar pantalla/paletas, input, bucle de frame, sprites/tiles y audio según el target. Prueba header/tamaño/bancos, comida/colisiones o mecánicas elegidas, guardado cuando exista, frame timing y límites de sprites/VRAM. Verifica con el emulador real, no renombres un binario de PC a `.gb`.

## PlayStation 1: primer build reproducible

Las releases de PSn00bSDK para Windows/Linux incluyen librerías, MIPS GCC, herramientas y ejemplos; CMake >=3.21 se instala aparte. Añade `<sdk>/bin` a PATH y configura las librerías en el preset CMake o en `PSN00BSDK_LIBS` según [la guía del SDK](https://github.com/Lameguy64/PSn00bSDK/blob/master/doc/installation.md). Copia `<sdk>/share/psn00bsdk/template` al nuevo proyecto y ejecuta:

```sh
cmake --preset default .
cmake --build ./build
```

El template oficial produce su imagen de CD; configura nombre/contenido del proyecto en vez de prometer una salida universal. Comprueba los archivos de salida y sus logs, arranca en el emulador con firmware autorizado cuando lo requiera, y prueba input, frame timing, render y audio. Memoria principal/VRAM, ordenamiento de polígonos, texturas, CD/carga y controlador son presupuestos reales; apariencia low-poly en Godot no sustituye esta ruta.

## NES/SNES/Sega

Empieza por un ejemplo de la versión del SDK escogida y conserva startup/linker/makefile apropiados; compílalo con su comando documentado antes de adaptar gameplay. NES requiere mapper/header y linker correctos, no solo `cc65 archivo.c`. PVSnesLib y SGDK dependen de sus devkits y makefiles, no de un compilador C genérico. Registra la invocación exacta verificada para ese proyecto.

Prueba en emulador adecuado y conserva evidencia independiente de build y gameplay: memoria/bancos, VRAM/paletas, sprites por scanline, DMA, sonido, mando y timings. La prueba de PC no prueba hardware original. Entrega ROM/disco, fuentes, versión/receta, controles y límites no comprobados, distinguiendo emulación de ejecución física real.
