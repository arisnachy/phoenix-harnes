# PHOENIX Game Studio — 离线可玩示例

[English](README.md) | 中文

这些**原创、离线运行**的示例建立了可复用的游戏机制，而非承诺完美商业美术、成品级音效或自动支持所有引擎。

## 运行方式

使用现代浏览器打开 `jungle-echo.html` 或 `lumen-circuit.html`，也可以把完整 HTML 作为 MIME `application/vnd.phoenix.game+html` 发布在 PHOENIX 中。聊天内预览通过隔离的 iframe 运行内联脚本，不需要外网或 CDN。

- **Jungle Echo**（横版射击）：A/D 或方向键移动；空格/上/W 跳跃；J/K 射击；I 斜向上瞄准；O 斜向下瞄准；M 控制声音；另有触摸按钮和重启功能。
- **Lumen Circuit**（解谜）：点击或触摸方块使其旋转；方向键移动键盘选择；Enter/空格旋转选中方块；New Game 开始新游戏。
- 两者均在用户操作之后启用 WebAudio，且都可以关闭声音。

## 可复用基础

- `game-kit.js` 包含解析式双骨骼反向运动学、协调的双腿与手臂、与武器瞄准同步的手部、方向控制、动画帧计算、视差和简单的有界敌人决策。由于预览不能下载外部文件，`jungle-echo.html` 已将它内嵌。
- 游戏工件检查支持按类型配置的 `gameType`（横版射击、平台、俯视动作、竞速、解谜、策略、RPG、节奏、模拟、3D 和自定义），因此解谜与竞速游戏无需伪造首领或枪械。
- 示例包含两种实际游戏循环：射击战斗和连接/旋转谜题。其他类型的配置只验证结构，不会自动生成该类型的实际游戏玩法。

## 全角色与场景的制作计划

制作具象横版射击游戏前，先运行 `node examples/game-studio/plan-game-assets.mjs jungle-echo.manifest.json game-plan.json`。该工具为主角、所有声明的敌人类型、首领各阶段、视差背景层、武器、弹丸、能力、道具、特效和音效创建**待办**任务。Kira 与 La Forja 必须真正制作并整合相应资产；此工具不会自动绘图。

达到制作完成标准的横版射击游戏中，每个 `art.enemies[].id` 和 `art.bosses[].id` 都必须对应真实的游戏实体，并有不同的 PNG 图集、帧网格和动画。首领的每个阶段需要通过 `phaseAnimations` 关联实际帧索引。每个 `level.layers[].id` 都需要对应 `art.backgrounds[].id`；此外需要 `art.weapons`、`art.projectiles`、`art.powers`、`art.props` 和至少两种不同的 `art.effects`。仅将图片嵌入 HTML 却未真正绘制，不能通过发布检查。音质和视觉完成度仍须在实际运行的游戏中验证。

### 复用已有素材和音效

将当前兼容打包器的 `assets.json` 作为规划器的可选第三个参数：

    node examples/game-studio/plan-game-assets.mjs manifest.json plan.json assets.json

规划器会核验本地 PNG/WAV/OGG/MP3 文件签名、游戏美术 ID 及声音事件 ID，并报告 `reusable-needs-integration`、`existingAssets.unbound` 和 `existingAssets.invalid`。优先复用已有文件，生成新资源后立刻接入动画、绘制或音频事件；不可仅凭文件存在就认定游戏完成。打包器拒绝没有可检测绘制或播放路径的素材，动态渲染器仍需实际游戏画面与声音测试。

## Godot 原生 Game Studio（按需自动启用）

Phoenix 根据**游戏实际复杂度**选择引擎，而不是只看用户是否要求在聊天里玩游戏。Tetris、Snake、Pong、象棋、Pac-Man、2048 等轻量复古、逻辑、棋盘游戏使用内置 HTML5 引擎及现有的 `phoenix_game` 聊天播放器。复杂动作游戏、角色游戏、竞速、RPG、2.5D 和 3D 则以 **Godot** 为唯一游戏运行时，并从**同一个 Godot 项目**导出；单独制作的 HTML5 仿制品不等价于原游戏。

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs route --genre "beat-em-up" --delivery desktop --quality production
node examples/game-studio/godot/bootstrap.mjs doctor
node examples/game-studio/godot/bootstrap.mjs setup --project "PATH/TO/NEW/GAME" --allow-install
node examples/game-studio/godot/bootstrap.mjs verify --project "PATH/TO/NEW/GAME"
```

- 优先检测已有的 Godot 4 可执行文件。仅在用户明确授权安装时，通过允许列表中的 WinGet/Homebrew/Flatpak 安装，并验证真实的可执行文件；Windows 上即使终端 PATH 尚未刷新，也应检测 WinGet 安装位置。
- 只在**新建的游戏目录**中从 `examples/game-studio/godot/starter` 创建项目，绝不覆盖用户原有的 Godot 场景和素材。
- 必须实际运行 Godot `--headless --import`、`res://tests/smoke.gd` 和连续 120 帧的无界面测试；版本号和静态 JSON 清单不算通过。
- 模板已有可互动的主角与 Boss 战斗状态，但仍是**美术和声音原型**。Kira 需要用批准的角色图集、Boss、美术特效、场景及真实录制的音乐音效替换几何占位图，并在编辑器及实际播放中检查；模板没有专业人声采样。
- `phoenix_game` 提供**两种明确的输入形式**：内置复古游戏用自包含 HTML 的 `file_path`；Godot Web 游戏用 Godot 实际导出的 HTML/JS/WASM/PCK 完整文件夹 `godot_export_dir`。播放器将完整资源包放在随机能力路径下，通过不透明来源的沙盒 iframe 展示；两种输入都必须位于任务工作区内。
- 使用 `node examples/game-studio/godot/web-export-preflight.mjs PATH/TO/WEB/EXPORT` 验证真实导出目录中匹配的 HTML、JS、WASM 和 PCK 字节。这仅是结构预检，**不能**证明浏览器中可以玩。
- Godot 4 Web 导出需要 Compatibility/WebGL2；优先单线程导出并在真实设备上测试。Godot 4 当前无法把 C# 项目导出为 Web 游戏。
- Godot AI 是可选项：在 Godot 4.7+ 才通过锁定版本的插件与需要认证的 Dock 创建 MCP 桥接；单独完成引擎安装不能冒充已连接 AI 编辑器。

### 在聊天中统一发布

1. 先执行 `game-tools.mjs route` 决定引擎。复古、棋盘和逻辑游戏直接运行单文件离线 HTML；复杂人物及 3D 游戏**只使用 Godot**。
2. Godot 游戏必须从完成的原生项目导出 Web（Godot 4.3+，单线程、Compatibility/WebGL2、GDScript），并将 `index.html`、`index.js`、`index.wasm` 和 `index.pck` 保存在任务所属的同一文件夹内。执行 `node examples/game-studio/godot/web-export-preflight.mjs PATH_TO_EXPORT`。
3. 调用 `phoenix_game`，传入 `title` 和 `godot_export_dir` 发布真实文件包，不传 `html` 或 `file_path`。Host 会把验证后的资源复制到作用域库，通过 `/phoenix-games/godot/<token>/index.html` 提供服务，并在对话中创建隔离的沙盒 iframe；无需手动打开 Chrome 或另做 HTML 仿制品。
4. **结构验证不是功能和质量验收。** 需要实际测试 WebGL2、操作、素材、输入、声音和性能。仅有文件回执不能证明游戏可玩。

## 可复用的动画游戏玩法与采样音频（2026 年 10 月）

射击示例已包含按 L 键、带冷却时间的魔法冲击，按 H 键的短距离鞭击，带动作预告的多阶段移动 Boss AI（瞄准弹幕、扇形齐射和地波），以及更多视听反馈和打击乐配乐。它仍是**插画原型**，不是商业级配乐或专业配音。

- `game-kit.js` 的 `drawSpriteState(ctx, image, atlas, state, seconds, x, y, width, height, face)` 会从嵌入图集中绘制**真正不同的动画帧**；缺失或无效动画会返回 false。单张概念图不等于动画。`advanceBoss(boss, player, dt, fire)` 在可见蓄力后发射真正的弹丸；`activateAbility(actor, seconds, cooldown)` 限制技能连续使用。
- Jungle Echo 读取 `art.hero`、`art.enemies[]`、`art.bosses[].phaseAnimations`、`art.backgrounds[]`、`art.weapons[]`、`art.projectiles[]`、`art.powers[]`、`art.props[]`、`art.effects[]`。存在资产时使用嵌入 PNG 代替几何图形；必须保留精确 ID 和帧尺寸。交付正式美术前应移除原型回退图并逐帧对照批准设计。
- 本地打包器接受含 `images` 和 `audio` 的 `assets.json`。当存在合法原创或授权的 WAV/OGG/MP3 文件时，使用 `phoenix-audio-shoot`、`phoenix-audio-whip`、`phoenix-audio-power`、`phoenix-audio-boss`、`phoenix-audio-music`、`phoenix-audio-voice-victory` 等事件 ID，执行 `node examples/game-studio/embed-game-assets.mjs game.html assets.json packed.html`。声音会以 data URI 内嵌，浏览器需用户交互后才能播放，M 键控制静音。
- 示例**没有**内置专业音源库或真人配音；程序化声音只是回退。高品质枪声、鞭击、对白需要导入经授权的原始录音，为每个游戏事件正确映射，并在浏览器实际听到声音后才能宣称完成。
- 运行 `pnpm exec vitest run examples/game-studio/tests packages/hardness/adapters/tests/game-art.spec.ts`，然后在真实浏览器中打开生成的 HTML。单凭结构测试无法保证视觉和听觉品质。

## 发布清单与美术资源

Game Studio 通过真正的模型工具 `phoenix_game`，在 Phoenix 聊天中发布可玩的独立 HTML。其 `phoenix-game-manifest` JSON 必须如实描述游戏；缺少清单是**结构错误**，并不能证明 JavaScript 启动失败。白屏问题还需通过运行时和浏览器控制台排查。

- 元数据示例文件：`jungle-echo.manifest.json`（射击）和 `lumen-circuit.manifest.json`（解谜）。这些文件描述真实示例实现；不要把射击游戏清单复制进竞速或解谜游戏。
- 对于精灵图，创建本地 `images.json`，例如 `{"images":[{"id":"hero-art","path":"assets/hero-atlas.png"},{"id":"jungle-bg","path":"assets/jungle.png"}]}`，然后运行 `node examples/game-studio/embed-game-assets.mjs input.html images.json with-assets.html`。PNG 字节会在游戏代码之前内嵌进离线 HTML。
- 运行 `pnpm exec tsx examples/game-studio/prepare-game.ts with-assets.html manifest.json publishable.html`，完成结构预检并生成唯一正确的内嵌清单。工具拒绝不一致或重复的元数据，不会编造缺失的行为。
- 有具象角色的游戏必须明确指定 `art.mode`：精灵与动画未完成时用 `prototype`；审核过的主角和背景 PNG 已内嵌时用 `production`。成品美术还需声明 `art.designReference`、`art.hero.imageId`、`frameWidth`、`frameHeight`、idle/run/jump/fall/shoot/hurt/death 的帧索引及 `art.backgrounds[].imageId`。发布工具拒绝缺失、未关联运行代码或未被 `drawImage` 使用的素材。
- 高质量人物概念画**不是**可播放的动画角色。应制作真正透明的精灵帧图集，将其绑定到动作状态，在实际运行的游戏里截图并比较跑动、瞄准和射击动作与已批准的角色设计。

## 验证与局限

- 确定性的 JavaScript 帧与输入冒烟测试覆盖源码，包括方向性角色运动和谜题交互。
- 源码或清单检查**不等于**视觉质量保证、动画对比或可听声音的播放测试。新的游戏必须在真实浏览器或设备上，通过截图、动画录制、声音试听、输入及性能测量进行验证。
- 程序化人物形状、振荡器音效和简单敌人决策只是技术参考，不能替代一致的精灵图集、精细背景、多轨声音混音、合法的原创或授权角色美术，以及完善的游戏平衡。
- Kira 的 `.agents/skills/phoenix-game-studio/SKILL.md` 说明了游戏类型路由、真实资料研究、专家协作、动画与素材制作、质量检查和停止条件。
