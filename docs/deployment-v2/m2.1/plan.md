# M2.1 动态验证计划

基线：M2 `36106f72ea9b0c1cd7f79503205ae3fa83ed7c90`，Agent `0.2.0-alpha.1`，CRM `3.44.0`。本阶段只增加测试与证据发布入口；不增加 Agent 任务，不改 V1，不安装到生产。

## 执行与安全边界

1. 审阅固定 workflow、测试 fixture 与公开证据格式；完成本地相关测试、类型、Lint、隐私检查并提交候选。
2. 用户批准后，仅向 `validation/deployment-v2-m2.1` 推送确切候选 SHA。该分支 push 触发新 workflow，避免 workflow 尚未进入远端默认分支时无法 dispatch 的问题。PR 不运行有特权的主机 fixture。
3. 复用 GitHub 托管 `ubuntu-24.04` 可丢弃 VM。两个 job 上限分别为 20 / 15 分钟；动态准备步骤上限 8 分钟，非特权 harness 上限 300 秒。没有生产凭据、自托管 Runner 或环境 secrets。
4. 仅在该临时 VM 创建全新非 root fixture 身份、私有目录和 user manager；复用 Runner Docker 二进制，必要时安装 uidmap / slirp4netns。已有用户名或目录冲突立即停止。不关闭 AppArmor、不更改宿主机 sysctl、不重新安装 Docker。所有改变随 VM 销毁。
5. 固定 Agent unit 与 Alpha payload 保持原样。测试 fixture 单独安装 / 重载 unit，不进入 runtime 包；应用请求不能使用压力程序或修改 unit。
6. 执行后保存 exact SHA / run ID / attempt、源码摘要、私有 runtime manifest 摘要、数值资源及逐项状态；原始日志只留忽略的 `work/ci-private/`，仅上传正向提取的固定 JSON 摘要。

## 动态矩阵与证据解释

| 项目 | 方法 | PASS 必须观察到 |
| --- | --- | --- |
| Linux SQLite / flock / 文件系统、Compose | 保留 M1 / M2 原生测试及固定 Compose 2.40.3 虚构 workload | 当前候选对应 job 成功；不能引用历史 CRM job |
| 固定 oneshot、CLI 退出 | 真实 user manager 加载原样 render-unit，CLI 派发后退出 | INTENT → PROVEN、消耗 grant、manager 完成、MainPID 归零 |
| 真实终端断线 | Python controlling PTY session 提交、派发，然后关闭 PTY master | kernel SIGHUP 杀死该会话，manager 任务继续完成；不同于 SSH / 整个登录 user manager 被销毁 |
| 同时准入 / 派发、flock | 4 个实际 CLI 竞争；活跃 worker 期间尝试写入 | 单 operation、单 intent、单 receipt；实际内核锁冲突 |
| 超时 / UNKNOWN | INTENT 后 SIGSTOP，让原 unit 的 15 秒超时触发 | manager 清理、grant 不复位、重新 start 不重放；显式 reconcile 保留 UNKNOWN |
| receipt 后事务失败 | 测试 SQLite trigger 中断完成事务 | receipt 已落盘；移除测试 trigger 后显式 reconcile 找回，receipt 字节和 mtime 不变；不是磁盘故障证明 |
| 空闲 | 读取 unit 与实际进程表 | MainPID=0，无 payload worker 进程 |
| Agent 资源 | 采样实际 Agent cgroup / 进程表 | 128 MiB、1 CPU、32 tasks 配置；记录 memory peak / CPU usage / tasks / RSS / 进程数；不把采样峰值当严格全时峰值 |
| 限制压力与子进程清理 | 独立测试 unit，完全相同的 128 MiB / 1 CPU / 32 tasks 与 KillMode；不修改 Agent ExecStart | 实际 OOM kill、cpu.stat 节流递增、pids.events 拒绝、超时后整个测试 cgroup 清空 |
| Rootless | 新 UID 的专属 daemon / Unix socket / data-root / user manager | Docker 报告 rootless、cgroup v2 / systemd，socket / data-root 归本 UID；不借用 Runner rootful daemon |
| Rootless 限额 | 独立 Rootless daemon 中运行固定预构建镜像的同预算压力程序 | 容器实际 cgroup 值、OOMKilled / exit137、CPU 节流、PID 拒绝；控制器缺失则 NOT_RUN |
| reboot / power loss / ENOSPC / EIO | 本次不对 GitHub 托管主机实施 | NOT_RUN，另需明确授权的可丢弃故障环境 |
| 生产目标版本 | Runner 是 Ubuntu 24.04，记录真实内核 / systemd / Docker 版本 | Ubuntu 26.04 / Docker 29.1.3 / Compose 2.40.3 / Buildx 0.30.1 整体兼容性仍 NOT_RUN |

Rootless 缺少包、user namespace 不可用、daemon 无法启动或控制器未委派时直接记录首个条件；不为通过检查扩大权限或改成 rootful。Docker 对 Rootless 资源限制要求 cgroup v2 与 systemd，不能仅检查 Docker CLI 参数。[上游资源限制说明](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)、[Ubuntu user namespace 约束](https://docs.docker.com/engine/security/rootless/troubleshoot/#distribution-specific-hint)。

## 证据、资源与门禁

公开文件固定为 `work/public-artifacts/deployment-v2-validation-summary.json`。仅允许已审 case ID、状态、原因枚举、版本数字、SHA 和数值测量，丢弃错误原文、环境变量、路径、UID / PID、业务内容。SHA / run / attempt 必须与当前执行一致；无报告发布 completed=false / FAIL，拒绝旧成功报告。

生产新增文件、unit、进程、数据库实例、磁盘均为 **0**。CI 新增一个临时 UID / user manager、一个短 Agent oneshot、最多一个 Rootless 测试 daemon、顺序运行的压力 unit / 容器以及私有 Node payload。Agent 候选预算保持 128 MiB / 1 CPU / 32 tasks；Rootless daemon 开销单独计，不包含在 Agent 内，也不成为生产依赖。镜像和 fixture 磁盘由 job 托管 VM 承担，实际测量写入验收报告。

**在真实 CI 执行完成前，M2.1 动态能力均 NOT_RUN，M3 完整集成 NO_GO。** 最终以当前候选证据重新判断；未通过或缺失的核心生命周期 / Rootless 项目不能用本地单元测试抵消。生产接入、真实数据库迁移、V1 fence / owner 交接、正式信任根、离线安装 / 回退及运输 load 仍按既有设计单独验收。
