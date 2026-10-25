# Phoenix Intentive Dock —— 产品规格 v1.0

[English](PHOENIX_INTENTIVE_DOCK.md) | 中文

**状态：**供 Kira 与 Phoenix 参考的功能和技术提案，**不代表已经实现**。**日期：**2026-10-14。**领域：**UI、Kira、UME、任务调度器、连接器。**目标：**按需利用聊天顶部栏的空白区域显示简短、相关、有用的信息，不永久占用页面。

## 产品决定

- Dock **默认完全空白且隐藏**，保留 Phoenix 现代橙色主题、会话标题及现有控件。
- 不加入游戏或游戏查看器；这些已在聊天内。也不复制 MiniBrowser、3D 查看器或其他大型界面。
- Kira 应先回答用户真正的问题，**只有实际有用时**才提出 Dock 或自动化建议。
- 用户明确要求“显示我的体育 Dock”时可直接展示；订阅、外部通知、私人数据和持久调度仍必须另外取得明确同意。
- Dock 可以临时显示、由用户固定或在设定的时间段**定时显示**；定时窗口结束后自动隐藏，固定项除外。
- 提醒必须持久存放于独立的任务/日历调度器，不能随着 Dock 关闭而丢失。
- 只显示可证实、带来源和更新时间的数据；明确区分空、载入中、离线、完成与过期，不伪造“实时”状态。
- 真正实施合并时保持 **main/stable 同步**；此文件只是规格，不得触发 Host 重启或生产变更。

## 建议的 30 个模块目录

| 编号 | ID | 模块 | 紧凑显示 / 操作 |
|---|---|---|---|
| 1 | sports-daily | 每日关注的体育队伍 | 按选定时间显示球队/联赛结果，可编辑偏好 |
| 2 | sports-live | 实时比分 | 徽标、比分、局数/节数/分钟及更新时间 |
| 3 | sports-schedule | 近期比赛 | 本地开赛时间、对手、赛事与提前提醒 |
| 4 | sports-standings | 排名 | 积分榜和相关领先者 |
| 5 | news-digest | 新闻摘要 | 选定主题与可核验来源 |
| 6 | daily-agenda | 今日议程 | 接下来的 1–3 项日历活动 |
| 7 | appointment-reminder | 预约提醒 | 即将开始的预约与用户同意的通知 |
| 8 | birthdays | 生日 | 可选提前提醒 |
| 9 | anniversaries | 周年纪念日 | 特别日期和倒计时 |
| 10 | priority-tasks | 优先任务 | 当天 1–3 个关键待办 |
| 11 | deadline-countdown | 截止期限 | 到期剩余天数或小时 |
| 12 | weather-now | 当前天气 | 选定城市、温度、图标和趋势 |
| 13 | weather-alert | 天气预警 | 重要变化与核实的官方警报 |
| 14 | commute | 交通与通勤 | 有来源的路线状态与出发建议 |
| 15 | priority-inbox | 优先收件箱 | 已授权的重要邮件摘要 |
| 16 | kira-mission | Kira/UME 任务 | 真实阶段、责任头像、阻塞与聊天入口 |
| 17 | artifact-ready | 产物完成 | 已完成文件、报告或应用 |
| 18 | github-status | GitHub 状态 | PR、测试、编译、部署 |
| 19 | phoenix-health | Phoenix 运行状态 | Host、语音、连接器及可核验诊断 |
| 20 | machine-health | 设备健康 | CPU、内存、磁盘与阈值提醒 |
| 21 | course-planner | 学习安排 | 近期课程、任务和考试 |
| 22 | research-watch | 研究追踪 | 按主题与来源发现新文章 |
| 23 | teaching-prep | 备课 | 下一堂课与待备材料 |
| 24 | fx-rates | 外汇汇率 | 选定货币及报价时间 |
| 25 | market-watch | 市场观察 | 资产价格、变动和来源 |
| 26 | finance-due | 财务到期 | 仅显示授权账单，不未经同意曝光余额 |
| 27 | flight-status | 航班状态 | 可得的官方日期、登机口或改签 |
| 28 | package-tracking | 包裹追踪 | 最新可核验物流状态 |
| 29 | custom-alert | 条件提醒 | 监测用户选定的事件、数据或阈值 |
| 30 | focus-routine | 专注日程 | 计时器、休息与预约时段 |

**P0（MVP）:** sports-daily、sports-live、daily-agenda、appointment-reminder、kira-mission、weather-now、custom-alert。**P1：**sports-schedule、news-digest、priority-tasks、artifact-ready、github-status、phoenix-health、birthdays、deadline-countdown、priority-inbox。**P2：**其余模块，需先接入真实数据源。

## 对话示例

- 用户关注 Dodgers、Lakers 和 Real Madrid：Kira 可询问是否每天早晨提供成绩简报、要不要在顶部暂时显示；用户选择同意、指定时间或拒绝。若时间和时区未定，必须先确定再创建任务。
- 用户问“Dodgers 打得怎么样？”：Kira 先给带来源的真实比分，再询问是否在比赛期间保留比分栏。
- 用户说“周四十点有预约”：如有日期歧义先确认，再提供提前一小时提醒或日历选项。
- 用户要求更新 Phoenix：先执行更新工作；仅在合适时建议显示任务真实进度。
- 用户问周末天气：先回答预报，再可选择临时摘要或重要变化提醒。
- 用户说“不要再推荐体育 Dock”：记录类别偏好，停止新建议，不影响已经保留的 Dock。

## 建议与同意协议

1. **识别意图**：判断任务、是否重复、日期时间、持续时间、数据来源及用户偏好。
2. **评估价值**：只给短小而相关的建议，不打断主答，每轮至多一条。
3. **尊重偏好**：隐藏、静音、永不再问和拒绝后的冷却期（例如可配置的 7 天）。
4. **明确确认**：创建重复任务、外部提醒、账户连接或读取私人资料前都需确认；“现在显示”不等于“以后一直通知”。
5. **启用**：记录已接受的提案及来源，提醒在持久调度器中创建，Dock 只是显示界面。
6. **到期与关闭**：临时 Dock 按事件终止或 TTL 隐藏；固定项目须由用户移除。可提供关闭、固定、提醒和配置。

## 视觉和交互设计

- 只使用聊天顶部栏的**中央空闲区域**，不得遮挡会话标题、搜索、模型/代理选择器及现有操作。
- 未接受 Dock、无上下文或不在定时窗口时不显示任何内容。
- 紧凑模式只显示**一个小胶囊组件**：图标/徽标、1–2 项数据、更新时间及可选计时器。多个项目用点击展开的低干扰列表，不自动滚动。
- 点击后在栏下打开轻量详情；复杂操作回到现有聊天/工具，不再创建大型查看器。
- 主题适配亮色与现代橙色，支持响应式布局、键盘与屏幕阅读器。
- 体育示例：“[Dodgers 标志] LAD 4–2 MIL · 第 7 局 · 30 秒前更新”；这**只是样例**，生产不得使用假比分。
- 同时出现时：已同意的安全/近期预约提醒 > 用户固定项目 > 明确要求跟踪的活动 > 定时摘要；不得悄悄替换固定项。
- 共享屏幕或旁人可见时保护邮件、患者、财务及其他私人信息；显示隐私摘要前应确认或解锁。

## 建议的数据模型

```ts
type DockModuleId = string;

interface DockSuggestion {
  id: string;
  conversationId: string;
  moduleId: DockModuleId;
  explanation: string;        // beneficio en español natural
  actions: Array<'show_once'|'pin'|'schedule'|'remind'|'dismiss'|'never_suggest'>;
  requiresConsent: boolean;
  expiresAt?: string;
}

interface DockSubscription {
  id: string;
  userId: string;
  moduleId: DockModuleId;
  visibility: 'ephemeral' | 'pinned' | 'scheduled';
  preferences: Record<string, unknown>;
  scheduleId?: string;
  timezone?: string;
  createdAt: string;
  enabled: boolean;
}

interface DockSnapshot {
  subscriptionId: string;
  state: 'ready'|'loading'|'stale'|'error'|'unauthorized'|'empty';
  title: string;
  summary: string;
  logoUrl?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  asOf?: string;              // horario verificable de última actualización
  expiresAt?: string;
  actionRoute?: string;       // ruta interna permitida y validada
}
```

UME、任务调度器、日历和真实数据源通过适配器接入。Kira 可以提出建议，但 **UI 绝不能把 LLM 生成的自由文本当成已获批准的指令**。按钮必须发送类型化、经过权限检查的事件。

可使用 `dock.suggestion.created`、`dock.suggestion.accepted`、`dock.subscription.updated`、`dock.snapshot.changed`、`dock.hidden`、`dock.expired`、`reminder.scheduled` 和 `reminder.fired` 等事件。必须处理用户身份、去重、幂等、取消和持久化。

## 数据与技术约束

- 体育：仅使用**授权来源**、遵守配额、当地时区与新鲜度规则；缺失连接时提供配置入口，不捏造比分。区分早晨简报和比赛实时跟踪。
- 日历/提醒：使用明确的本地日期，重复任务需要确认；Host 关闭时要披露限制，关机期间提醒只能通过经过授权的远程服务实现。
- 天气、新闻、价格：每份快照都有日期、来源和适当 TTL；没有真正更新就不能写“实时”。
- Kira/UME：使用官方执行遥测，不造假进度，收到全局停止后不得继续工作。
- 安全：最小权限，不展示凭据，校验链接，防范 XSS 和任意 iframe，保护敏感资料。
- 性能：懒加载适配器，避免密集轮询，优先复用已有 WS/SSE，关闭时释放订阅；不能阻塞聊天渲染和语音。
- 尊重默认西班牙语配置和可访问性偏好。
- Dock 永远可选，不应留下永久空白容器。

## 验收标准

1. 新建会话不显示 Dock，顶部栏原样保留。
2. 普通问题不触发无差别建议。
3. Kira 先回答用户，再自然提出有价值的建议。
4. 拒绝或静音后不会立即再次建议同一类别。
5. “仅现在显示”不会建立未来任务或连接。
6. “每天早晨我的体育”必须确认球队、时间、时区并真正持久调度。
7. 比分、数据时间和更新状态必须可核验，否则明确标注缺失。
8. 预约提醒在界面重启后依然可取消与恢复（取决于调度器状态）。
9. 不重复已经在聊天内的游戏查看器和 MiniBrowser。
10. 桌面与移动布局不能遮挡既有控件。
11. 顶部栏不得无意暴露私人内容。
12. 临时 Dock 过期自动隐藏，固定 Dock 遵循用户意愿。
13. 连接器报错不能破坏聊天、输入、语音或导航。
14. 没有构建、集成测试与可见验证，不得宣称已经实现。
15. 最终交付时 **main 和 stable 必须是同一个版本**。

## 交给 Kira 与团队的工作

**Kira（协调）：**盘点现有 UI、事件、提醒及连接器，优先复用既有组件，按 P0/P1/P2 分阶段实施。**Sol（规划）：**列出具体文件、同意流程与持久调度器，将工作拆分为可度量里程碑。**团队专员：**每个模块先实现一个真实来源、轻量 UI、存储与权限，并遵守当前配置的代理数量。**验证：**覆盖默认不显示、同意/拒绝、数据刷新、过期、无障碍、重连与性能。**关闭：**完成验证后全局停止，并报告结果、证据、风险和状态；不得对尚未发生的启用、调度或交付做出承诺。

本规格是**设计交接文档**；真正发布还需要独立的代码实现和测试。
