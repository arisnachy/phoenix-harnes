# Phoenix Geo Intelligence — 集成地图界面契约（v1）

[English](phoenix-geo-intelligence.md) | 中文

**状态：** 已实现原生地图界面 v1 基础，不代表具有服务端地理编码、路线规划或空间分析。属于 Phoenix Universal Mission Engine，并非独立应用。

## 通过真实工具交付原生地图

引擎提供 React 查看器 `GeoMap`，但仅凭 Kira 声称创建了地图并不代表已经发布。对于真实地理信息，Kira 必须以验证后的 WGS84 图层及 `title`、`map.source` 调用 `phoenix_geo_map`。工具会在聊天中发布 MIME 为 `application/vnd.phoenix.geo+json` 的持久产物，与 `generative-ui` 块共用查看器。`artifactId` 回执只证明产物已发出，**不证明**客户端发生点击或截图。

不要用 `phoenix_scene_map` 制作多米尼加共和国等真实地图。若研究缺乏可核实的坐标或可比较的地区统计数据，必须说明限制，不得虚构点位、多边形、省级比率或排名。地方性高血压样本不能自动代表整个省份。

聊天中的地图缺失提示区分独立产物与当前消息中的地图块。真实地理信息应调用 `phoenix_geo_map`；仅在虚构世界使用 `phoenix_scene_map`。

## 由 Kira 生成

具有**经过核实的坐标**且用户需要空间可视化时，Kira 可发送 **generative-ui** 代码块：

```generative-ui
{
  "component": "geo_map",
  "version": 1,
  "props": {
    "id": "sucursales-octubre",
    "conversationId": "id-opcional-si-se-conoce",
    "title": "Rendimiento de sucursales",
    "subtitle": "Selección territorial",
    "theme": "business",
    "source": "Archivo de sucursales proporcionado por el usuario",
    "updatedAt": "2026-10-20",
    "metric": "Ventas",
    "center": { "lng": -70.704, "lat": 19.451 },
    "zoom": 11,
    "layers": [
      {
        "id": "puntos", "name": "Sucursales", "kind": "points",
        "features": [
          {"id":"s-1","label":"Sucursal A","coordinates":[[-70.704,19.451]],"value":120,"color":"#15926b"}
        ]
      }
    ]
  }
}
```

仅接受有效的 `geo_map`。所有坐标和几何采用 **[经度, 纬度]（WGS84）**，视图中心使用 `center: {lng,lat}`。支持 `points`、`line`、`polygon`、`heat` 图层；v1 `heat` 是圆形符号，不是密度插值。真实地图支持缩放、平移、图层显隐、选择、标签、向 Kira 输入框添加上下文，以及导出 GeoJSON、CSV 和矢量 SVG。SVG 不带栅格底图，须在报告中明确说明。

`conversationId` **必须** 是当前会话真实且稳定的 ID，不得跨会话复用。中心与缩放级别只在本地按对话和地图隔离保存。规范属于消息内容，保留在历史中且可重新生成。数据应从文档或授权的连接器获取，不得编造地点、数值或路线。

学术报告应附带 SVG 的完整图例、来源、日期、单位、坐标系及方法说明。报告由现有的编辑／PDF 流程生成；本组件不单独承诺 PDF。优先使用 SVG 几何与 GeoJSON 保证可复现性。

## 限制与扩展

- 首次渲染不新增 npm 依赖。OpenStreetMap 栅格瓦片受使用政策约束，需显示署名，且不支持离线下载。高负载商业用途上线前应配置获授权的提供商或自建服务器。
- 最多 12 个图层、3,000 个几何对象、每对象 400 个顶点。大规模聚合需要未来的 PostGIS/H3/deck.gl 后端，不得在浏览器里静默执行。
- 交互不会向模型授予权限或设备位置访问。选择操作仅向输入框添加文字，不执行隐藏操作。
- 外部地理编码和空间访问必须使用获授权的提供商、用户同意及可追踪记录。避免用具体点位或小区域识别患者。
- 后续计划包括地理编码器、路线与等时圈、汇总空间统计、集成 PDF 导出、3D/PMTiles 地图、时间图层，以及与 Host 持久数据集双向集成。

## v1 验收标准

测试应覆盖：无效规范不执行代码、不同对话 ID 隔离、联网瓦片可见、缩放和平移、选择添加到输入框、图层禁用、矢量 SVG、有效 GeoJSON、防 CSV 公式注入、localStorage 视口状态隔离。

界面通过 `AssistantNodeView` **自动绑定真实会话 ID**；规范中的可选 ID 不能替代或破坏 Host 隔离。也可安全显示 MIME 为 `application/vnd.phoenix.geo+json` 的 JSON 产物，而不执行脚本。

## 真实位置编译器

使用含有已核实坐标的 CSV（`latitud`、`longitud`、`nombre`、`ventas`／`valor`）或 GeoJSON，通用引擎命令可生成地图规范：

```powershell
pnpm geo --input datos.geojson --output mapa.geo-map.json --source "Registro oficial" --title "Análisis territorial" --theme research --polarity neutral --report mapa-metodo.md
pnpm test:geo
```

CSV 也接受英文列名。可选指标方向为 `higher-better`（高值绿色）、`higher-worse`（高值红色）和 `neutral`（不解释）。不能把高发病率默认视为良好表现，必须由研究者明确选择指标方向。JSON 是交付文件，Markdown 记录科学报告的方法。当前计算仅为描述性统计；公路距离、等时圈和按人口校正的流行病学分析仍需专门模块。
