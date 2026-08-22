# PHOENIX AI Bus

`@deepseek-ai/dsh-phoenix-ai-bus` 是 PHOENIX 的计算成本通道层。它观察 DeepSeek Harness 原生 LLM 注册表，将已注册模型分类为本地免费、远程免费或计费/未知。

它**不会**授予模型权限。PHOENIX Runtime 的能力阶梯仍然是信任闸门；AI Bus 只对已经通过权限检查的候选项进行成本排序。

## 免费通道

- **Ollama** 视为本地零边际成本计算。PHOENIX 不猜测已安装模型；`createOllamaProfile(model)` 必须接收真实模型 id。
- **OrcaRouter** 只有模型 id 明确表示免费时才属于远程免费，例如 `orcarouter/free` 或 `-free` 模型别名。
- 其他路由保持 `metered-or-unknown`，直到有显式策略证明其成本属性。

## OrcaRouter 预设

`ORCAROUTER_FREE_PROFILE` 使用 OpenAI 兼容端点 `https://api.orcarouter.ai/v1`，通过 `ORCAROUTER_API_KEY` 引用凭据而不保存密钥，并声明 `orcarouter/free`。

## Ollama 预设

```ts
import { createOllamaProfile } from '@deepseek-ai/dsh-phoenix-ai-bus'

const profile = createOllamaProfile('the-model-that-is-actually-installed')
```

默认端点为 `http://127.0.0.1:11434/v1`。

## 设计规则

成本、能力和权限是彼此独立的维度。DSH 注册表证明路由存在；AI Bus 判断成本通道；PHOENIX 能力阶梯判断角色权限；路由器随后才可优先选择更便宜且已获授权的候选模型。

## Model Experience

### Cost-lane policy

#### What the model sees

模型不会直接看到 AI Bus 新增的提示词或工具。它只影响其他 PHOENIX 消费者在完成权限检查后的路由选择。

#### Token effect

直接上下文开销为零。路由变化可能改变实际调用的提供商或模型，但 AI Bus 不向请求添加内容。

#### KV Cache effect

AI Bus 不改写请求前缀。切换到不同提供商或模型时，不假设可以跨模型复用 KV cache。

## Known Limitations and Deferred Work

- **免费额度感知** — 当前分类基于显式模型身份，不读取账户实时剩余额度。
- **Ollama 自动发现** — 当前要求提供真实本地模型 id；自动发现留给专门的 provider-discovery 能力。
- **成本遥测** — `metered-or-unknown` 保持保守；实时价格和每次请求成本 receipt 尚未加入。
