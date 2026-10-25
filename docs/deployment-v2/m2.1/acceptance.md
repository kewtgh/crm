# M2.1 动态验证验收记录

日期：2026-10-26。基线 `36106f72ea9b0c1cd7f79503205ae3fa83ed7c90`；Agent `0.2.0-alpha.1` / CRM `3.44.0` 保持不变。

**当前阶段：候选准备，外部执行尚未授权。CI Run ID：NOT_RUN；当前候选的 systemd / Rootless 动态能力：NOT_RUN；M3 完整集成：NO_GO。** 该记录不把已编写的 harness 或历史本地测试认定为外部验证通过。

## 交付范围

- 固定验证分支触发的托管 Ubuntu 24.04 job，contents:read、checkout 不持久化 Git 凭据；PR 不执行特权主机 fixture。
- 独立 `deployment-v2-agent/validation/` 测试命名空间：固定 unit 安装 fixture、真实 PTY、并发 CLI、内核锁、超时、显式 reconcile、独立同预算压力程序和 Rootless 边界探测。它们不进入 buildRuntime 制品。
- 受审最小化 JSON 发布器：绑定 SHA / run / attempt，禁止上传原始日志；固定状态 / 原因 / 数值 allowlist。未完成执行标记 FAIL，未执行能力保留 NOT_RUN。
- [执行计划](plan.md) 记录权限、CI 预算、资源测量方法、缺失环境的处理和后续门槛。

## 当前本地验证

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| Node | PASS，24.22.1 | 开发机实际版本 |
| Agent 类型与 Lint | PASS | 原严格 runtime 类型合约保留；没有修改运行模块 |
| 新验证工具 JS checkJs / Lint | PASS | 独立 JS 类型检查；不是 Linux 动态证明 |
| M2 Windows 回归 | PASS，21 passed / 0 failed / 3 NOT_RUN | 现有 24 项；Linux 信号、unit 导出、真实 manager 未执行 |
| 公开仓库隐私 | PASS，14 / 14 | 含两个固定 JSON 上传白名单及生产信息隔离 |
| 新证据发布合约 | PASS，6 / 6 | 过期运行、状态保真、正向提取、固定 CI 权限 |
| Bash 语法 | PASS | 本机已有固定 Node Linux 镜像，无网络、只读源；仅 bash -n，不运行 provision |
| 外部当前候选 CI | NOT_RUN | 尚未推送 / 获得运行 ID |
| 真实 user systemd / PTY / 限额 / Rootless | NOT_RUN | 必须由真实外部执行补齐 |
| reboot / power loss / 磁盘故障 | NOT_RUN | 本次未提供专用故障设施 |

Windows 进程 kill、SQLite trigger abort 与 Docker Desktop 不替代真实 L2；保留 M1 测试定义并在当前候选外部 job 执行，尚无该 run 的成绩。

## 资源与无生产副作用的证明范围

Agent `src/`、既有 unit 模板、V1、业务数据库及应用发布入口均无变更。候选保持 128 MiB / 1 CPU / 32 tasks。实际 Agent cgroup 进程数 / tasks / RSS / memory peak / CPU usage、Rootless daemon 进程树 RSS 和分配磁盘等待外部测量，不填估算值冒充实测。独立压力 fixture 的限制生效证明与实际 Agent 的资源测量分开记录。

生产新增文件 / 服务 / 进程 / 数据库 / 磁盘均为 **0**。本次只修改本地仓库，并在本机已存在的 Docker Desktop 执行无网络 bash 语法检查；没有连接生产。这个范围说明不能替代生产只读适配或证明未接触环境的运行状态。

## 后续证据与决策

获准推送后，以候选完整 SHA 对应的 Workflow Run ID / attempt / job 环境和公开摘要更新本文件；保留真实失败和 NOT_RUN。报告文档提交与已测试候选 SHA 分别记录，不能把报告提交误认为已动态测试。

在必要的生命周期、Rootless 与资源限制证据补齐前，**M3 完整集成 NO_GO**；允许继续在本阶段隔离 fixture 中验证。生产安装 / 发布始终未授权。正式来源信任、安装 / 回退、运输 load 身份与空间、重启 / 磁盘故障及 V1 owner 交接仍依原设计分项验收。
