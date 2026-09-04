# `@phoenix-ai/dsh`

[English](README.md) | 中文

`dsh` 是 PHOENIX 中用于启动 profile 的命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |
| `dsh chatgpt-web <start\|status\|stop>` | 启动、检查或停止显式配置的本地 ChatGPT Web Responses 网桥。 |
| `dsh upstream-update --check` / `--apply` / `--doctor` | 检查或安全接收已初始化的 Codex plugin 与 OpenClaw skill bridge 更新。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## ChatGPT Web 网桥

PHOENIX 可以将本地的 [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) 网桥作为 `chatgpt-web` 模型路由使用。网桥负责浏览器登录与 cookie；PHOENIX 不会导入或保存这些内容。在 Windows 上，请先在已安装的 Codex Web GPT 启动器中完成 `Setup > Browser-only`；随后 `dsh chatgpt-web start` 会自动发现完整的打包运行时，并忽略不完整的安装。其他安装仍可使用 JSON argv 配置：

```powershell
$env:PHOENIX_CHATGPT_WEB_COMMAND = '["node","C:\\path\\to\\codex-chatgpt-web\\server.mjs"]'
$env:PHOENIX_CHATGPT_WEB_URL = 'http://127.0.0.1:17841/v1'
dsh chatgpt-web start
dsh chatgpt-web status
```

Browser-only 使用已登录的 ChatGPT Web 会话，不需要付费模型 API 密钥；仍然需要符合条件的 ChatGPT 账户、浏览器登录以及正在运行的本地网桥。选择该路由前，`dsh chatgpt-web status` 必须报告 `ready`。

只接受 loopback 端点。生命周期记录只保存进程 id 和端点，不保存命令行 secret。`dsh doctor` 可以检查已配置的网桥，但不会启动或修改它。

## Codex 与 OpenClaw upstream intake

Intake watcher 将已初始化 bridge 的 state 与 official `main` heads 比较，在独立的 DSH home 中暂存 candidate，运行原生 bridge verification，并且只激活通过 journal transaction 的 candidate。`PHOENIX_UPSTREAM_UPDATE_MODE=auto` 会应用已验证的 candidate，`notify` 会记录可用性，`off` 会禁用 watcher。未配置的 bridge 会保持 idle。参见 [upstream intake reference](../../docs/evolution/PHOENIX_UPSTREAM_INTAKE.zh.md)。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.zh.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@phoenix-ai/dsh-base`、`@phoenix-ai/dsh-web-app`、`@phoenix-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.zh.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
