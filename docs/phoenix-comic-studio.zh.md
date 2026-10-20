# Phoenix Comic Studio — 漫画编辑记忆与制作

[Español](phoenix-comic-studio.md) | 中文

Comic Studio 为 Phoenix 提供可复用的漫画创作能力，而不是改变通用智能体框架或强制采用游戏引擎。它将系列、角色、参考图与故事时间线保存在 `~/.dsh/comic-studio/series/<id>/` 的 JSON 和图像文件中，可跨对话、模型供应商与重启继续使用。根目录可以通过 `PHOENIX_COMICS_HOME` 配置。Kira 可使用 `phoenix-comic-studio` 技能调用本地引擎，再通过原生 `phoenix_comic` 工具直接在聊天中展示作品，无须独立标签页或 MiniBrowser。

## 命令

```bash
node scripts/phoenix-comic-studio.mjs init "Guardianes de Orión" guardianes-orion
node scripts/phoenix-comic-studio.mjs world guardianes-orion reglas.json
node scripts/phoenix-comic-studio.mjs asset guardianes-orion hero-front hero-front.png
node scripts/phoenix-comic-studio.mjs character guardianes-orion personaje.json
node scripts/phoenix-comic-studio.mjs location guardianes-orion lugar.json
node scripts/phoenix-comic-studio.mjs issue guardianes-orion entrega.json
node scripts/phoenix-comic-studio.mjs art-brief guardianes-orion numero-uno
node scripts/phoenix-comic-studio.mjs asset guardianes-orion art-panel-1 panel-1.png
node scripts/phoenix-comic-studio.mjs page guardianes-orion numero-uno pagina.json
node scripts/phoenix-comic-studio.mjs audit guardianes-orion numero-uno
node scripts/phoenix-comic-studio.mjs render guardianes-orion numero-uno --pdf --cbz
node --test scripts/phoenix-comic-studio.test.mjs
```

`render` 会保存真正的 `comic.html` 阅读器，其中嵌入光栅画稿，文字以独立图层排版。`--pdf` 通过 Chrome/Chromium 输出 PDF；`--cbz` 通过 Chrome/Chromium 把各页转换为 PNG，再与 `ComicInfo.xml` 一起打包。运行环境必须安装并能运行 Chrome；`PHOENIX_COMICS_CHROME` 可指定浏览器路径。如果浏览器失败，HTML 仍然保留，但不得宣称 PDF/CBZ 输出成功。`--draft` 可预览缺少资源的页面，并将输出标记为草稿；正式导出则会因缺失资源或因果状态错误而被阻止。

## 输入结构

第一版的 `reglas.json` 是不可变世界规则的数组，例如 `["Los portales abren solo de noche"]`。

`personaje.json`：

```json
{"id":"venga","name":"Venga","description":"Protagonista","visualSignature":"Pelo plateado, ojo izquierdo verde, chaqueta escarlata y cicatriz bajo el ojo derecho","voice":"Directa","baseline":{"costume":"scarlet","injury":"none","location":"tower"},"references":{"front":"hero-front","profile":"hero-profile"}}
```

角色的各项参考图必须在创建角色之前用 `asset` 导入，且同一资产 ID 不能悄悄替换为不同像素。角色改版需采用新的参考图 ID，明确创建编辑版本，并复核受影响的画格。角色资料卡本身并不保证生成模型的画风或外貌一致；它是后续条件生成与比对的权威设定。

`lugar.json`：`{"id":"tower","name":"La torre","description":"Azotea con antenas","referenceAsset":"tower-front"}`。

`entrega.json`：`{"id":"numero-uno","number":1,"title":"El portal","synopsis":"La primera grieta entre mundos"}`。

`pagina.json`：

```json
{
  "number":1,
  "rows":[2,1],
  "panels":[
    {"id":"n1-p1-a","asset":"art-panel-1","location":"tower","action":"Venga observa el cielo","visualPrompt":"Plano americano, noche, abrigo rojo, mismo rostro aprobado","characters":[{"id":"venga","pose":"de pie","costume":"scarlet","expression":"alerta"}],"dialogue":[{"speaker":"venga","text":"Hay algo al otro lado.","type":"speech"}],"changes":[]},
    {"id":"n1-p1-b","asset":"art-panel-2","location":"tower","action":"El portal parpadea","characters":[],"dialogue":[{"speaker":"narrator","text":"Medianoche.","type":"caption"}],"changes":[]},
    {"id":"n1-p1-c","asset":"art-panel-3","location":"tower","action":"Venga toca el borde del portal","characters":[{"id":"venga","pose":"brazo extendido","costume":"scarlet","expression":"temor"}],"dialogue":[],"changes":[{"subject":"venga","field":"injury","before":"none","after":"burn","reason":"La energía le produjo una quemadura visible"}]}
  ]
}
```

`rows` 给出每行画格数量（最多四格），其总和必须与 `panels` 完全相同。每位出场角色必须事先定义；`changes` 按期数、页码及画格顺序依次生效。审核会拒绝不一致的状态转移、跳号、重复 ID、无效的参考图、被篡改的画稿以及空白页。默认不能正式发布缺少图片的场景。

## Kira 的视觉制作流程

1. 理解自然语言请求（“创造一本漫画……”“续写下一期……”），编写世界设定、规则、角色、地点、镜头序列和期数；创建新系列前先尝试恢复既有项目。
2. 导入已获批准的正面、侧面和四分之三视角参考图。维持脸部、剪影、色板、配饰和场景的一致性；新图片需要复核，不能默认视为同一个角色。
3. 使用已连接供应商或已安装工具的真实图像生成能力，并传入对应参考图与 `art-brief` 简报。不能把简报或不存在的文件冒充完成的漫画。如果工具不支持参考图条件生成，明确说明限制并加强视觉比较。
4. 编写每个 `pagina.json`，导入画格、执行审核和排版。修改问题画格时保留其他已批准画格，并检查成品中的对白、阅读方向和气泡大小。
5. 实际打开并检查导出页面，与权威设定核对，商业发布或收费前还需确认授权和版权。针对真实印厂补齐插画封面、署名和出血设置；初版不会验证出血、ISBN、最终无障碍性和视觉艺术质量。
6. 将 `project.json` 与 `assets/` 保存在 Phoenix 临时运行目录之外。修改项目时更新版本号，`release.json` 记录输出文件哈希，但不能充当外部平台发布成功的证据。

## 保证与限制

持久图库保存文字设定、以 ID 和 SHA-256 标识的参考图、画格顺序，以及跨期的因果状态变化。系统本身不包含图像生成模型、面部识别、视觉向量、自动绘图、感知质量判断、外部授权或商店发布。审核中的 `visualConsistencyVerified:false`、`narrativeQualityVerified:false`、`rightsVerified:false` 和 `humanArtReviewRequired:true` 表明：结构验证通过不等于角色外貌相同、作品原创或已经符合商业印刷标准。

## 在聊天内直接发布

Kira 生成真正的画稿并用 `render` 排版后，使用系列 ID 和期数 ID 调用 `phoenix_comic`。Host 重新读取 `release.json`，验证 `draft:false`、`structurallyValid:true`、路径及 `comic.html` 的 SHA-256，同时要求至少一页包含真实 PNG/JPEG/WEBP 数据的画格，随后输出 `application/vnd.phoenix.comic+html`。客户端以静态隔离 HTML 呈现响应式页面，不会把 Phoenix 自身作为嵌套网页打开。该回执仅证明制品被接纳以及图片数据结构符合规则，不证明角色长相、艺术质量、故事准确度或商业平台发布。`file_path`（受限于工作区）和内联 `html` 是未登记作品的替代输入。如果没有实际绘图工具或生成失败，Kira 必须明确报告阻碍，不能单凭聊天声明或 MiniBrowser 状态宣布漫画已经发布。
