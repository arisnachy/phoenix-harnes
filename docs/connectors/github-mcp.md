# GitHub MCP en PHOENIX: crear y configurar un token personal

GitHub MCP permite a Kira consultar repositorios, commits, issues, pull requests,
releases y flujos de GitHub Actions desde PHOENIX.

**No es GitHub Copilot.** GitHub Copilot es un proveedor de modelos independiente.
El servidor remoto oficial de GitHub MCP está en
`https://api.githubcopilot.com/mcp/`, pero ese nombre de dominio no obliga
a iniciar sesión en GitHub Copilot.

## 1. Crear un fine-grained personal access token

1. Abre **[Crear token de GitHub (Fine-grained PAT)](https://github.com/settings/personal-access-tokens/new)** e inicia sesión.
2. En **Token name**, escribe `Phoenix GitHub MCP`.
3. En **Expiration**, elige una caducidad limitada, por ejemplo **90 días**.
4. En **Resource owner**, selecciona tu cuenta o una organización que te autorice a usar sus repositorios. Algunas organizaciones deben aprobar estos tokens.
5. En **Repository access**, elige **Only select repositories** y selecciona exclusivamente los que usará PHOENIX.
6. En **Repository permissions**, concede únicamente los permisos necesarios:

   | Permiso | Para empezar | Cuándo ampliar |
   |---|---|---|
   | **Metadata** | Read (automático) | No hace falta ampliarlo |
   | **Contents** | Read-only | Read and write para crear/editar archivos |
   | **Issues** | Read-only | Read and write para abrir o modificar issues |
   | **Pull requests** | Read-only | Read and write para crear o modificar PR |
   | **Actions** | Read-only si se van a consultar CI y workflows | Ampliar solo para gestionar ejecuciones |
   
   GitHub puede solicitar permisos adicionales para operaciones específicas. No
   concedas acceso de escritura para tareas que solo consultan información.
7. Pulsa **Generate token**. Cópialo una vez: GitHub no volverá a mostrar su valor.

## 2. Conectarlo en PHOENIX

1. Actualiza PHOENIX a una versión que admita GitHub MCP mediante PAT y reinicia el Host.
2. Abre **Configuración → Conectores → GitHub**.
3. Si todavía no está instalado, pulsa **Instalar MCP GitHub**.
4. Pulsa **Configurar token GitHub**; escribe el token **en el campo secreto de la tarjeta GitHub**, nunca en la conversación.
5. Pulsa **Continuar**. PHOENIX guardará el token en el vault local bajo
   la referencia `GITHUB_MCP_TOKEN` y reconectará el servidor. El archivo
   `managed.patch.yml` guarda **solo el nombre de la referencia**, nunca el valor.
6. Comprueba que el estado es **operativo**, que hay herramientas MCP disponibles
   y que una consulta de solo lectura puede listar tus repositorios.

## 3. Si GitHub sigue sin conectar

- **Se rechaza el token (401/403):** verifica caducidad, propietario del recurso,
  repositorios autorizados, políticas de la organización y permisos finos.
- **Conectado pero sin herramientas:** verifica el estado real del runtime del MCP,
  no únicamente `gh auth status`. GitHub CLI y GitHub MCP son rutas distintas.
- **Registro dinámico OAuth rechazado:** actualiza el Host. El servidor remoto de
  GitHub no admite DCR; PHOENIX debe usar su flujo de token PAT, sin solicitar
  una página OAuth inexistente.
- **`managed MCP patch row N is invalid`:** actualiza a una versión que
  reconozca exactamente la configuración GitHub PAT. No borres el archivo ni
  pegues su contenido (puede contener referencias/configuración sensible).
- **Token revocado o expirado:** usa otra vez **Configurar token GitHub** para
  reemplazarlo, y comprueba que las herramientas se reconectan.

## Seguridad

- No publiques tokens en chats, capturas, repositorios, logs ni enlaces compartidos.
- Prefiere un **fine-grained PAT** con acceso limitado a los repositorios necesarios.
- Revisa y revoca tokens desde
  [GitHub → Settings → Personal access tokens](https://github.com/settings/personal-access-tokens).
- El inicio de sesión OAuth de **GitHub Copilot (modelos)** es distinto del token
  de **GitHub MCP (repositorios)**.

Referencias oficiales:
- [GitHub: managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
