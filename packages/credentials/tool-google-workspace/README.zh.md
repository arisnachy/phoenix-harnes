# @phoenix-ai/dsh-tool-google-workspace

[English](README.md) | 中文

这是基于 Host 所有的 `ctx.googleApi` broker 的面向模型 Gmail、Google Calendar、Google Drive 与受限高级 Google Workspace 工具。该包永远不会接收 OAuth access token、refresh token、authorization code、PKCE verifier 或任意目标 URL：Host broker 固定每个 Google API 根地址和所需 scope，并只在最终网络边界注入 Bearer token。

专用工具覆盖 Gmail 搜索/读取/发送、Calendar 事件列表/创建以及 Drive 搜索。`google_workspace_request` 是 Docs、Sheets、Slides、Contacts 和尚未拥有专用工具的 Workspace 操作的受限补充入口；它仍只接受一个枚举的 Google 服务和该服务下的相对路径。

## 模型体验

### 已连接的 Google Workspace 工具

#### 模型看到什么

当该包和 `googleApi` 服务挂载后，模型会获得稳定的 Gmail、Calendar、Drive JSON 工具 schema，以及受限高级请求工具。模型只看到操作参数和不含秘密的 API 结果。授权由用户通过 Phoenix Settings 完成，并保持在模型请求之外。

##### 工具 schema

```markdown
See the generated Google Workspace entries in [the tool catalog](../../../docs/tool-catalog.md#phoenix-aidsh-tool-google-workspace).
```

#### Token 影响

已加载的工具 schema 会增加固定的提示词成本。Google 账户数据只会在显式工具调用后进入会话，并且大型响应正文在渲染前受到边界限制。

#### KV Cache 影响

只要该包保持挂载，工具定义就保持前缀稳定。OAuth 状态不会进入可复用前缀；API 结果只会追加在工具调用之后。

## 已知限制与暂缓事项

- Google OAuth 当前是进程本地状态，因此 Phoenix 重启后需要再次显式授权 Google，直到存在能够与同 UID 工具进程隔离的凭据后端。
- Google installed application 会在一次 consent 流程中请求配置好的 Workspace scope 集合；未授予 scope 的能力会 fail closed，并需要显式重新连接来改变授权。
- 当前专用高层工具主要覆盖 Gmail、Calendar 和 Drive。Docs、Sheets、Slides、Contacts 与较少使用的操作暂时通过 `google_workspace_request` 使用，直到增加专用工具。
- 高级请求工具故意不接受任意 URL、调用方认证 header、cookie 或调用方选择的 OAuth scope。
