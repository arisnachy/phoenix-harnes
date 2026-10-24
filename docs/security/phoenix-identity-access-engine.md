# Phoenix Identity & Access Engine — V1

English | [中文](phoenix-identity-access-engine.zh.md)

## Propósito

El broker privado de Phoenix separa la identidad personal del usuario y una identidad de servicio Kira por **origen HTTPS exacto**. Nunca se comparten secretos entre dominios/subdominios. La interfaz protegida del chat es el único destino de credenciales nuevas; los agentes y MCP solo observan resultados sanitizados.

## Flujo

1. MiniBrowser inspecciona si el sitio necesita autenticación.
2. Si existe una sesión válida, no abre Secure Ask.
3. Si caducó, consulta `/phoenix-secure-login/status?origin=...`.
4. Selecciona el perfil activo (`personal` como predeterminado cuando existe; `kira` si es el único acceso guardado o fue seleccionado explícitamente).
5. Si ese perfil permite inicio automático, el broker de host intenta el acceso en la misma pestaña con la bóveda cifrada.
6. Si no hay autorización automática, Secure Ask muestra perfiles y permite seleccionar el acceso guardado o dar de alta uno nuevo.
7. La desaparición verificable de la puerta de login es condición para cerrar Secure Ask; pulsar el botón de acceso no constituye prueba de sesión.
8. Las tareas en curso y borradores quedan fuera de la bóveda y no se envían ni repiten como efecto colateral del inicio de sesión.

## Almacenamiento

- Personal conserva el archivo DPAPI `<sha256(origin)>.dpapi.json` y su entropía original, de modo que funcionan los accesos existentes.
- Kira utiliza `<sha256(origin)>.kira.dpapi.json` con entropía DPAPI separada.
- La preferencia de perfil reside en `<sha256(origin)>.primary.json`.
- Las credenciales heredadas de la bóveda anterior se leen como perfil personal. Su migración no las elimina automáticamente.
- El borrado solicita un perfil concreto y nunca afecta al otro perfil.
- Los archivos de secretos nunca se incluyen en Git ni pasan por el modelo.

## API privada del host

Los endpoints existen bajo `/phoenix-secure-login`, restringidos a localhost, con encabezado protegido y origen de petición válido.

- `GET /status?origin=...` devuelve perfiles, disponibilidad y preferencia, nunca contraseñas.
- `POST /select` fija el perfil existente elegido por el usuario, ligado a la pestaña/origen.
- `POST /save` guarda un nuevo secreto bajo el perfil elegido.
- `POST /use` intenta iniciar sesión con un perfil guardado y autorizado.
- `POST /delete` borra **solo** el perfil solicitado.
- `POST /detect` inspecciona el login sin exponer el contenido de los campos.
- `POST /provision-eligibility` evalúa precondiciones sin registrar cuentas.

## Creación de cuentas Kira

No confundir una identidad guardada con una cuenta efectivamente creada en un tercero. V1 admite conservar y usar cuentas Kira que ya existan y registrar sus credenciales de forma protegida.

El aprovisionamiento autónomo requiere, además, un adaptador concreto de sitio con registro soportado, autorización explícita anterior del usuario, correo/identidad verificable y cumplimiento de las condiciones del servicio. Un silencio del usuario **no** es autorización. Los sitios financieros, de apuestas o con verificaciones de identidad no reciben registros automáticos mediante este motor. En ausencia de un adaptador aprobado, `provision-eligibility` responde `site-adapter-required`, sin crear cuentas ni simular el resultado.

## Criterios de aceptación

- Una cuenta personal existente se puede seguir usando sin migración forzada.
- Kira y personal coexisten sin sobrescribir contraseñas.
- Cambiar de perfil utiliza el registro elegido, nunca el del otro.
- La baja de un perfil no destruye el otro.
- Secure Ask no muestra entrada vacía cuando el perfil ya está guardado.
- No se declara login exitoso sin verificación de estado real.
- No se registra ninguna cuenta por tiempo de espera sin consentimiento.
