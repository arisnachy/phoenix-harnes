# `@phoenix-ai/dsh-healthia-local`

[English](README.md) | 中文

`ctx.healthia` 的加密 owner-local provider。

该 provider 将 HealthIA 数据保存在 PHOENIX conversation/session memory 之外。规范文档在写盘前使用 AES-256-GCM 加密。加密密钥通过 `ctx.credentials` 解析；当配置的引用不存在且可写时，provider 会在那里生成随机 256-bit 密钥，而不是把密钥和健康记录放在一起。

写入使用仓库已有的跨进程 writer lock 和 atomic replacement；在支持 POSIX mode 的平台上，文件和目录使用仅 owner 可访问的权限。每次 mutation 都会在锁内重新读取已提交文档，防止一个 PHOENIX 进程静默覆盖另一个进程刚提交的患者变更。

默认密钥引用：`PHOENIX_HEALTHIA_DATA_KEY`。

## Model Experience

### Encrypted local provider

#### What the model sees

该 provider 注册 `ctx.healthia`，但不会渲染 prompt 或患者数据；所有模型可见投影都由模型侧 HealthIA consumer 拥有。

#### Token effect

存储、加密、加锁和凭据解析本身不增加模型 token。

#### KV Cache effect

该 provider 对缓存保持中性。读取或写入加密记录只有在 consumer 随后投影这些有界记录时才会改变模型前缀。

## Known Limitations and Deferred Work

- **单个加密本地文档** — 适合第一阶段 owner-local 基础。大型影像/文档字节应进入独立的加密附件/证据存储，而不是不断扩张这个 JSON envelope。
- **尚未绑定 OS keystore** — 加密密钥目前由 PHOENIX 现有 credential seam 保护。以后可增加平台 keystore provider，在不改变 `ctx.healthia` 的情况下加强静态密钥保护。
- **尚无同步/临床互操作 provider** — FHIR、Health Connect、医院、实验室和云 provider 应映射到同一个 provider-neutral service，而不是绕过它。
