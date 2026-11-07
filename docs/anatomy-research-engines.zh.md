# PHOENIX 解剖研究引擎

[English](anatomy-research-engines.md) | 中文

PHOENIX 仅用于研究的解剖模拟接口需要真实影像、专家准备的几何结构和物理参数。心电图、X 光片和 GLB 渲染不能替代这些输入。

## 可执行集成

- SimVascular 0D：svZeroDSolver 接受专业人员准备的血管网络 JSON 并输出 CSV。可选隔离环境尝试安装 svzerod==3.2；完整 3D 血流模拟还需要网格、单位、边界条件以及经过验证的求解器参数。
- openCARP：在 Linux 或 WSL2 Ubuntu 24.04 中执行 openCARP -par CONFIG -simID OUTPUT；需要专家准备的网格和参数文件。输出仅供研究，不能当作临床电生理诊断。
- SimVascular 图形界面：可以启动已安装的原生 Linux 程序或官方 WSL 文件。成功打开界面或进程退出，都不表示模拟经过验证。
- 解剖任务：scripts/phoenix-anatomy-models.json 记录经过核对的 TotalSegmentator 任务和模态。细小周围神经、心肌瘢痕、大脑纤维束和冠脉微血管需要额外经过验证的模型或专家掩膜。

## 操作命令

检查 node scripts/phoenix-anatomy-simulation.mjs doctor 和 node scripts/phoenix-anatomy-workbench.mjs doctor。通过 node scripts/phoenix-anatomy-workbench.mjs models 查看任务。重建可用：node scripts/phoenix-anatomy-workbench.mjs reconstruct --input STUDY --output PRIVATE --modality ct --task ct_general --research-only --view。比较 NIfTI 分割可用：node scripts/phoenix-anatomy-workbench.mjs validate --pred PRED --reference REFERENCE --output QA.json --research-only。

血流求解器命令：node scripts/phoenix-anatomy-simulation.mjs run --engine svzerod --input INPUT.json --output RESULTS.csv --research-only。电生理使用 --engine opencarp --input INPUT.par --output OUTPUT-DIRECTORY --research-only。打开图形界面需将 PHOENIX_SIMVASCULAR_BIN 设置为官方程序路径并运行 launch --engine simvascular。

对于已经准备好网格、物理特性与边界条件的 SimVascular 有限元项目，可运行：node scripts/phoenix-anatomy-simulation.mjs run --engine svmultiphysics --input PROJECT/solver.xml --output PROJECT/1-procs --research-only。输出目录必须尚不存在。Windows 上由 WSL2 在转换后的 Linux 项目路径中调用官方 svmultiphysics。程序不会根据 GLB 或心电图自动猜测 XML、网格或边界条件。

## 科学验证

参考掩膜的质量报告包含 Dice、HD95、敏感度、体积和空间配准指标。这些指标不能证明诊断安全性或法规许可。临床人员主导的验证需要预先制定方案、代表性的外部数据、不确定性分析、亚组审查、不良失效案例、合适的影像质量与签署复核。物理模拟还要求收敛分析、患者特异性边界条件、正确物理单位以及与实测生理数据的比较。

## 平台与安全

Windows 上运行当前 SimVascular 和 openCARP 需要 WSL2 或兼容容器。安装器只检测相关程序，不会自行提权或静默执行需要管理员权限的安装。模型和许可证依据模态、任务和用途而异。患者影像必须留在获授权的本地或机构存储中，不能进入普通对话或公共仓库。
