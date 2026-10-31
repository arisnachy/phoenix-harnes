# PHOENIX Quant：Kronos 预测辅助服务（仅 PAPER）

[English](README.md) | 中文

Kronos 开源 K 线模型是可选的决策辅助工具。预测不等于经过校准的概率、
已证明盈利的策略，也不提供 REAL 实盘下单权限。关闭预测后，
原有技术策略仍可工作。

## 自动安装

在 PAPER 交易面板中选择 **Instalar Kronos gratis**，或执行：

```sh
node scripts/phoenix-kronos-install.mjs
```

需要 Python 3.10–3.12、Git、网络连接、磁盘空间和内存。
安装程序在 `~/.phoenix/kronos` 创建独立的 CPU Python 环境，
并检出官方上游提交 `67b630e67f6a18c9e9be918d9b4337c960db1e9a`。
模型权重将在首次使用时下载。完成安装不代表模型已就绪，也不代表已成交。

## 模型

- Kronos-mini：410 万参数，默认选择，适合较轻量的 CPU 推理。
- Kronos-small：2470 万参数；启动 Host 前设置
  `PHOENIX_KRONOS_MODEL=small` 即可使用更大的模型。

两种模型的权重与代码均为开源，不需要按次支付预测 API 费用，
但仍消耗硬件资源和下载带宽。

## 算法与安全

1. 获取 Binance Spot 公共 OHLCV 行情，并只分析已收盘 K 线。
2. 优先执行现有持仓的保护性退出，再评估新的预测入场。
3. 仅在启用时为通过技术筛选的 PAPER 候选入场调用 Kronos。
4. 校验准确的 K 线时间、交易对、周期和预测有效性，并扣除预计的
   双向手续费、滑点及安全边际后评估预期收益。
5. 保留现有 PAPER 持仓与风险敞口限制，只把账本中确认的成交计为交易。
6. 对模型缺失、过时、数据错误或超时的预测采用拒绝入场策略。

独立的推理进程不会收到账号凭证、API 密钥、生产订单命令或
用户控制的服务地址。本地无人值守执行仍需要 PHOENIX Host 持续运行。

## 启用任何 REAL 实盘交易前的评估

必须在不同市场状态下进行按时间顺序的滚动样本外验证，扣除手续费、
滑点并应用交易所过滤规则。应衡量样本外期望收益、回撤、
实际成交、风险敞口以及长期 PAPER 测试的一致性。
本功能不启用自主 Binance REAL 交易，也不保证盈利。

## 来源

- [Kronos 上游](https://github.com/shiyu-coder/Kronos)
- [Kronos-mini 权重](https://huggingface.co/NeoQuasar/Kronos-mini)
- [研究论文](https://arxiv.org/abs/2508.02739)
