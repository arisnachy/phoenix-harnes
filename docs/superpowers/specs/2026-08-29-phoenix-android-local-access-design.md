# Acceso local de PHOENIX desde Android

## Objetivo

Crear una aplicación Android nativa que se empareje con PHOENIX mediante un código QR mostrado en Settings y permita chatear, recibir avisos, observar la ventana de PHOENIX y ejecutar controles limitados mientras el teléfono y la computadora estén en la misma red privada.

La primera versión no ofrece acceso desde Internet, VPN, relay, servicios externos, reenvío de puertos, UPnP, descubrimiento público ni control libre del sistema operativo.

## Decisiones aprobadas

- Plataforma inicial: Android nativo.
- Transporte: HTTPS y WebSocket dentro de la red LAN privada.
- Emparejamiento: invitación QR de un solo uso con caducidad corta y confirmación en ambos dispositivos.
- Identidad: claves por dispositivo protegidas por Android Keystore y almacenamiento local protegido en PHOENIX.
- Pantalla: captura autorizada de la ventana o viewport de PHOENIX, nunca del escritorio completo por defecto.
- Control: comandos semánticos permitidos por una lista explícita; no hay shell, archivos, teclado/ratón libre ni ejecución arbitraria.
- Notificaciones: avisos locales de Android mientras existe una sesión local autorizada; no se promete entrega cuando Android haya detenido completamente la aplicación.
- Instalación: el QR inicia la descarga local de un APK firmado y el sistema Android conserva la confirmación de instalación; ningún QR puede saltarse esa protección.

## Arquitectura

### Capacidad de PHOENIX

La capacidad se implementa como una extensión Cordis con definición de servicio, proveedor local y consumidor de Settings.

- `mobile-access` define la identidad de dispositivo, las invitaciones, las sesiones locales, las capacidades autorizadas, el estado de conexión y la revocación.
- El proveedor host mantiene el servidor LAN, el certificado local, el registro de dispositivos, el protocolo de comandos y el adaptador de captura de PHOENIX.
- El consumidor `ui-settings-mobile-access` añade una tarjeta de Settings con estado, dirección privada, huella, QR, permisos, dispositivos emparejados, revocación y botón de desactivación.
- El cliente Android usa Kotlin y Jetpack Compose, conserva las claves en Android Keystore y comparte únicamente los tipos de wire documentados con el host.

La capacidad se monta como plugin y se desmonta cerrando el servidor, cancelando capturas, eliminando listeners y revocando sesiones activas.

### Servidor LAN

El servidor escucha solo en direcciones IPv4 o IPv6 privadas enumeradas por PHOENIX y nunca en una interfaz pública por configuración automática.

El arranque rechaza una dirección pública, una configuración de wildcard no autorizada, un intento de modificar reglas UPnP o una ruta de reenvío de puertos.

La configuración de Windows debe limitar el tráfico al perfil de red privada y al ámbito de la subred local. Si esa restricción no puede aplicarse, PHOENIX mantiene la función deshabilitada y explica el motivo en Settings.

El servidor usa TLS local con certificado generado para las direcciones privadas activas. El certificado se guarda junto a la configuración protegida de PHOENIX y su huella se muestra en Settings y se incluye en el QR.

### Protocolo

Los endpoints son específicos de la capacidad y no reutilizan el puente `/api` general ni permiten invocar métodos Typert arbitrarios.

- `GET /mobile-access/bootstrap` devuelve solo la versión del protocolo y el estado de una invitación válida.
- `POST /mobile-access/pair` acepta una invitación no usada, la clave pública efímera del teléfono y una firma de prueba.
- `GET /mobile-access/events` mantiene el canal WebSocket de eventos autorizados.
- `POST /mobile-access/command` acepta únicamente comandos del registro semántico y requiere una firma válida del dispositivo emparejado.
- `GET /mobile-access/screen` entrega frames de la captura autorizada con límites de tamaño y frecuencia.

Cada mensaje incluye versión, identificador de sesión, nonce, contador monotónico y marca temporal tolerante a pequeñas diferencias de reloj. El host rechaza contadores repetidos, saltos fuera de ventana, firmas inválidas, versiones desconocidas y tamaños superiores al límite.

TLS protege el transporte y la autenticación por clave de dispositivo protege la sesión de aplicación. Los datos de chat y control se cifran además con una clave efímera derivada durante el handshake; el servidor local solo enruta bytes entre los dos extremos.

## Emparejamiento por QR

1. El usuario abre `Settings > Acceso móvil` y pulsa `Emparejar Android`.
2. PHOENIX genera una invitación aleatoria de alta entropía con identificador, secreto, expiración de 60 segundos, URL privada y huella del certificado.
3. Settings muestra el QR y un código corto de confirmación; la invitación no se escribe en logs ni se conserva después de usarse o expirar.
4. Android escanea, verifica que la dirección pertenece a una red privada y valida la huella TLS antes de enviar cualquier credencial.
5. El teléfono genera o recupera su clave de dispositivo desde Android Keystore y firma el desafío del host.
6. PHOENIX muestra el nombre del dispositivo y su huella; el usuario confirma en la computadora y en el teléfono.
7. El host almacena únicamente la clave pública, nombre, permisos, fecha de emparejamiento y último estado; el secreto QR queda invalidado.

Una invitación expirada, repetida, alterada, con huella distinta o proveniente de una dirección no privada se rechaza sin crear una sesión.

## Permisos y control

El dispositivo emparejado comienza con visualización y chat. Los permisos de control se activan de forma separada desde Settings y se pueden revocar sin eliminar el emparejamiento.

El registro inicial de comandos contiene solo:

- enviar un mensaje al chat activo;
- seleccionar una sesión ya visible;
- detener la ejecución actual;
- responder una solicitud de aprobación pendiente;
- abrir una sección concreta de Settings;
- solicitar o detener la captura de la ventana de PHOENIX.

Cada comando se valida contra el dispositivo, la capacidad habilitada, la sesión actual, el estado del agente y una política de expiración. El host no acepta nombres de métodos arbitrarios, rutas, comandos de shell, expresiones JavaScript, coordenadas de pantalla, acceso a archivos ni cambios de credenciales.

Las acciones que puedan detener trabajo o aprobar una operación muestran una confirmación explícita en Android y un indicador visible en PHOENIX. Un botón `Desconectar todos` cancela sesiones, detiene captura y revoca tokens temporales.

## Pantalla y notificaciones

La captura se limita al viewport o ventana de PHOENIX y se activa por una solicitud visible. La UI muestra un indicador persistente mientras se capturan frames. El proveedor aplica límite de resolución, frecuencia, memoria y tiempo de sesión, y descarta frames al cerrar el canal.

Android solicita el permiso de notificaciones en el momento de activar avisos. La aplicación usa un servicio en primer plano solo cuando el usuario lo habilita y Android muestra la notificación permanente exigida por el sistema. Si el proceso es detenido por el sistema, el estado se marca como desconectado y la aplicación sincroniza los avisos al volver a abrirse.

Los eventos de notificación llevan texto mínimo y no incluyen credenciales, contenido sensible ni dumps de pantalla. El contenido completo se recupera por el canal TLS local después de autenticar la sesión.

## Instalación desde Settings

Settings puede servir un APK firmado desde la dirección LAN, mostrar versión, huella SHA-256 y fecha de compilación, y generar un QR que abre esa página local.

El flujo se detiene si el APK no está firmado con la clave esperada o si la huella no coincide. Android conserva la decisión del usuario sobre instalar aplicaciones desde esa fuente y puede requerir habilitar manualmente el permiso del navegador o gestor de archivos.

La función no descarga desde Internet, no usa una tienda externa y no intenta modificar políticas del sistema. La firma de producción y la distribución final quedan fuera del repositorio si no existe una clave de firma proporcionada de forma segura.

## Manejo de fallos

- Red pública o interfaz no privada: la capacidad permanece deshabilitada.
- Certificado cambiado: se exige un nuevo QR y confirmación de huella.
- Invitación vencida: se elimina el QR y se genera otro.
- Firma o contador inválido: se cierra la sesión y se registra solo un motivo técnico sin payload.
- Relay o servicio externo solicitado: no existe en esta versión y la UI lo declara como no disponible.
- Android sin permiso de notificaciones o captura: chat permanece disponible y el estado explica el permiso faltante.
- PHOENIX se cierra: el host revoca las sesiones temporales y el teléfono muestra desconexión.
- Pérdida de red: el cliente reintenta con backoff limitado y nunca degrada a HTTP sin TLS.

## Verificación

### Pruebas de protocolo y seguridad

- Rechazo de direcciones públicas, wildcard y cambios de interfaz no autorizados.
- Expiración, reutilización y alteración de invitaciones QR.
- Validación de huella TLS y firma de dispositivo.
- Rechazo de replay, contador repetido, nonce incorrecto, tamaño excesivo y versión desconocida.
- Rechazo de comandos fuera de la lista y de dispositivos revocados.
- Cierre completo de WebSocket, captura y listeners al desmontar el plugin.
- Ausencia de UPnP, reenvío de puertos, relay y llamadas a servicios externos.

### Pruebas de producto

- Settings muestra estado, dirección privada, huella, QR y revocación.
- Un Android emparejado puede enviar un mensaje y recibir el resultado del chat.
- Detener, aprobar y seleccionar sesión actualizan el estado real de PHOENIX.
- La captura se inicia y detiene con indicador visible y límites aplicados.
- La app muestra conexión, reconexión, permiso faltante y revocación.
- El APK servido localmente informa versión y huella antes de instalar.

La compilación Android requiere Android SDK, Gradle, Kotlin y `adb`; estas herramientas no están instaladas en el checkout inspeccionado y deben prepararse antes de ejecutar las pruebas de dispositivo o emulador.

## No objetivos

Esta versión no ofrece acceso fuera de casa, control remoto del escritorio, acceso a archivos, shell, credenciales, instalación silenciosa, notificaciones push garantizadas con la app detenida, autenticación multiusuario ni garantía de riesgo cero.

## Ampliación futura separada

El acceso fuera de la red local requiere permitir un relay, un servidor propio o una VPN. Esa ampliación necesita una nueva revisión de amenazas, política de costes, gestión de identidad y aprobación explícita; no se habilita cambiando una URL o exponiendo el servidor LAN.
