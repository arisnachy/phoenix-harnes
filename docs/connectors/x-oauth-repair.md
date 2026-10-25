# X/Twitter: reparación de OAuth en Phoenix

English | [中文](x-oauth-repair.zh.md)

## Identidades distintas

- `x-docs`: documentación oficial pública; **no** autoriza una cuenta.
- `x-api`: cuenta X del usuario; necesita una aplicación de X Developers y consentimiento OAuth 2.0.
- `x-api-phoenix`: cuenta propia de Phoenix previamente creada y verificada en X; identidad y credencial de usuario distintas. El alta oficial puede requerir intervención humana.

Phoenix instala el puente oficial [xurl](https://github.com/xdevplatform/xurl) mediante el MCP local. La presencia del proceso, de la tarjeta o de un listado de herramientas **no es prueba de sesión autenticada**.

## Autorizar

1. Abre [X Developer Console](https://console.x.com/) y verifica que la aplicación está habilitada para OAuth 2.0, con permisos adecuados al caso. La URL de redirección debe coincidir **exactamente** con `http://localhost:8080/callback`, salvo que hayas configurado oficialmente otra en xurl.
2. Introduce el Client ID y Client Secret **solo** en el formulario de Configuración → Conectores → X. Phoenix los pasa al proceso MCP por referencias protegidas del vault, no como argumentos o en el chat. Ten en cuenta que el ejecutable oficial xurl también persiste sus propias credenciales y tokens en el perfil local del usuario de Windows (`~/.xurl/auth.yml`): protege ese perfil y no leas/copias ese archivo en el chat.
3. Instala o reconecta `x-api`. La primera autorización del puente xurl abre el navegador del usuario Windows donde se ejecuta Phoenix. Si no abre, confirma que `npx` puede ejecutarse en ese Host, que el puerto TCP 8080 no está ocupado y que la URL registrada es idéntica. El tiempo inicial para completar OAuth puede superar varios minutos.
4. Para diagnóstico local sin exponer tokens, ejecuta `npx -y @xdevplatform/xurl auth status` en una terminal del **mismo perfil Windows**. Si xurl ya tiene la aplicación registrada localmente y no puede manejar el callback, puedes usar `npx -y @xdevplatform/xurl auth oauth2 --headless` siguiendo el flujo oficial y sin pegar códigos o URLs de retorno en el chat.
5. Tras la autorización, comprueba una **consulta real** con `xurl whoami` o una herramienta de lectura del MCP. Un estado OAuth válido puede coexistir con `client-not-enrolled` si la aplicación no está en el entorno o plan de API requerido. El plan X puede incurrir en cargos; Phoenix no debe activarlo de forma silenciosa.

**No** confundir el OAuth de xurl con el OAuth genérico de los servidores HTTP MCP: este último no puede registrar por sí mismo una X Developer App. Reparar no debe borrar identidades, refrescos ni tokens válidos si no hay indicio de corrupción. La autorización de usuario X nunca se reutiliza como autorización de la cuenta Phoenix.

## Diagnóstico rápido

| Síntoma | Comprobación |
| --- | --- |
| El botón instala pero no abre autenticación | Verifica xurl, proceso Host, navegador disponible en Windows; comprueba callback/puerto 8080 |
| Página callback rechazada | URI de X Developers coincide exactamente con la efectiva de xurl |
| 401 / token expirado | Reautorizar en xurl para la cuenta y aplicación correctas |
| `client-not-enrolled` | Revisar plan de API X y entorno Production; no es un problema del navegador |
| El MCP aparece activo sin consultar datos | Solo prueba proceso y herramientas, no OAuth; hacer una lectura real |

Fuentes: [xurl oficial](https://github.com/xdevplatform/xurl), [MCP oficial X](https://github.com/xdevplatform/docs/blob/main/tools/mcp.mdx).
