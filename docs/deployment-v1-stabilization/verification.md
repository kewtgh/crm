# V1 稳定化验证记录

2026-10-26。审计先行提交 `7060403e84489ccc39a77bad9308e899d5018d8a`，应用保持 3.44.0。本记录只描述本次证据，不沿用 V2 CI 成绩。生产未连接、未发布。

## 修复与保留边界

- Docker 29.1.3 的 data-root 启动权限与旧门禁冲突：仅对该目录接受 0700/0710/0711；Docker / Buildx 客户端配置仍须私有，错误 UID、symlink、canonical 路径、socket、Rootless、systemd cgroup v2 一律拒绝。[实际写入实现](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/daemon_unix.go#L1285-L1318)。这证明代码冲突，不证明未知生产故障的具体现场。
- 隔离失败保留固定 stage/code、role/mode/ownerMatches、白名单 errno/exitCode；命令 stderr、环境值、任意错误路径与全量 daemon JSON 不进入新诊断。依赖项保留 dependsOn；host-upgrade-plan 与 Controller Entry 不再丢失首因。REJECTED 凭证格式不变，详细诊断走输出而不是另建持久化证据协议。
- Host Preflight 和 Runner 共用 Unix 账户 home/runtime/bus 设置；冲突的 Docker endpoint/context/config 或用户 bus 配置明确拒绝，不回退其他账户 / Rootful。共享函数不写文件、不提权。
- CLI 外层与锁内 start 使用轻量准入；创建新 deploy/initialize 请求前仍以 git show 验证绑定目标；Bootstrap 合并前和 Controller Entry 执行前保留发布安全检查。完整维护 bundle、维护专用 unit、prune flags 与 inspect --bootstrap 不再阻断普通发布。原有所有锁、未完成升级、磁盘、Builder 身份及 Compose 隔离字段继续检查。
- 请求 / launch / handoff / entry receipt / migration ledger / accepted release / terminal archive / finalization / rollback / recover 均沿用原协议。没有修改状态目录、维护程序、unit、镜像或系统包，不自动接受未知迁移、不重放未知操作。

## 已执行与待执行

| 验证 | 结果 | 证据与限制 |
| --- | --- | --- |
| V1 完整部署定向回归 `npm run test:deploy` | PASS：222；FAIL：0；NOT_RUN：1 | 28.99 秒；包含真实 Git 跨提交接管、真实 Compose 2.40.3 安全模型、接受 / 归档 / 故障恢复；唯一跳过为未提供专属测试 PostgreSQL，未连接业务库。原日志仅在忽略的 work/v1-stabilization/ |
| 最终 Host Preflight / 兼容性 / Compose 能力定向回归 | PASS：51；FAIL：0 | 覆盖轻量准入时配置读取失败也保留首因；不以 full 检查替代实际 admission 路径 |
| 新增 Linux 文件准入与内核 flock | PASS：2 | 本地 Docker Desktop Linux VM 内，缓存 Node 24.22.1 Debian slim 镜像；真实文件竞争、/proc 祖先与设备/inode、独立竞争进程和锁释放。仅映射虚构锁的路径，不创建固定宿主机锁；不是 Ubuntu / Rootless 认证 |
| Windows 原生执行上述两项 | NOT_RUN：2 | 测试显式 skip，未计入 Windows PASS；Linux 容器实测另列 |
| 根项目类型检查 | PASS | 固定 Node 24.22.1，既有 TypeScript native compiler；无业务 TypeScript 修改 |
| 修改文件 ESLint | PASS | 仅 V1 CLI / Bootstrap / Runner / 相关 lib 和 tests，不运行整个仓库审计 |
| 隐私门禁 | PASS：14 | 固定诊断正向提取回归、仓库隐私和 CI artifact 白名单；不上传新增原始日志 |
| 外部 Ubuntu 26.04 + Docker 客户端 29.1.3 / Buildx 0.30.1 / Compose 2.40.3 | PASS | [Run 40221342101](https://github.com/kewtgh/crm/actions/runs/40221342101)，测试 SHA `68d79bb1d7f2a6f5f3c27f469e9e3a8d668a5dce`；原生 Ubuntu 客户端能力 / Compose 安全模型、V1 回归 222 PASS + 数据库 1 NOT_RUN、内核锁与文件准入 2 PASS、隐私 14 PASS、类型与 Lint 通过；未访问 daemon |
| Ubuntu Rootless daemon / 实际生产部署 / 真实业务迁移 | NOT_RUN | 不借用旧 Rootful 或 V2 成绩，不访问生产，不扩大本阶段试验范围 |

Linux 本地测试镜像身份：`node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`。
测试容器 --rm、无网络、只读 rootfs / 最小七个公开源文件挂载、非 root UID、cap-drop ALL / no-new-privileges，临时 /tmp 32 MiB，memory 128 MiB / 1 CPU / 32 PID。2 项测试 0.25 秒，容器退出删除；这些是执行限制与耗时，不冒充峰值内存测量。

## 外部 CI 与控制面变更边界

[V1 专用工作流](../../.github/workflows/deployment-v1-validation.yml)复用 GitHub 托管 Ubuntu 26.04，限定 `validation/deployment-v1-stabilization`，单 job 最长 15 分钟、只读 token、不持久化 checkout 凭据、不使用 secrets / SSH / 数据库 / Docker socket。主分支不会触发该验证 job。
仅下载 Ubuntu 签名 APT 索引认可的精确主版本客户端包并解包至 work/，不安装包、不停止或替换 Runner daemon；记录包与源码 SHA256、完整测试 SHA 和 Run ID。真实 Compose / Buildx 命令使用临时私有 config 与不可达测试 socket。需要 daemon 的能力不计为 PASS。包缺失、版本偏差或安全字段不符直接失败，不静默换版本。工作流不发布原始 artifact。
Ubuntu 软件包依据：[docker.io-app 29.1.3](https://packages.ubuntu.com/source/resolute/admin/docker.io-app)、[docker-buildx 0.30.1](https://packages.ubuntu.com/source/resolute/admin/docker-buildx)。是否可由当次 Runner 安装源取得，以实际 CI 为准。

本次已取得上述客户端包，仅解包执行，未安装：docker.io `29.1.3-0ubuntu4.1`、docker-buildx `0.30.1-0ubuntu1`，Ubuntu `amd64v3` 包。Runner image `ubuntu-26.04 / 20261012.163.1`、runner `2.338.0`；测试运行窗口为 UTC 2026-10-25 18:27:40 至 18:28:26（本地为 2026-10-26）。[最小 CI 证据](ci-evidence.json)保存精确测试提交、Run/Job ID、软件版本、包 / Compose / 核心源码摘要及结果；原始三轮日志保留于忽略的 work/v1-stabilization/，不上传公开 artifact。

失败历史不覆盖：

| Run | 完整测试 SHA | 结果与最小修复 |
| --- | --- | --- |
| [40220973108](https://github.com/kewtgh/crm/actions/runs/40220973108) | `8087265778369b5bb74ef8ce0fcc308a3029f311` | 客户端准备退出 100，未执行部署测试；静默 APT 输出不足以定因 |
| [40221213517](https://github.com/kewtgh/crm/actions/runs/40221213517) | `8e838f773d47483ddb62ee83e9f3ee42037a60c2` | 增加阶段输出后确认签名索引成功，失败在 apt-cache 版本选择管道；部署测试仍 NOT_RUN |
| [40221342101](https://github.com/kewtgh/crm/actions/runs/40221342101) | `68d79bb1d7f2a6f5f3c27f469e9e3a8d668a5dce` | 版本选择不再让 awk 早退关闭管道；相同版本 / 安全约束下全部相关步骤成功，未改 V1 修复代码 |

对照结果支持将退出 100 归因于 CI 选择器的早关管道 / pipefail 组合，而不是 Docker 能力缺失。两次 CI 修正仅改变测试步骤的可解释性与取版本方式，不安装包、不放宽版本门槛。首次候选仍可由原 SHA / 日志审查；后续报告提交不替代成功测试 SHA。

常规应用修改不改变 host-runtime-contract、维护 bundle / 兼容目录、unit、handoff / receipt / 状态格式或控制器启动语义。涉及这些文件的修改须独立说明兼容性与运行回归；不兼容变更在目标静态检查处拒绝，另行审核，不能在普通发布时自动安装或升级控制面。此次仅新增诊断字段与代码内固定检查范围，不增加请求可控制的检查级别。公开 CLI 只允许 full / deployment，不暴露 admission；默认 host-check / host-upgrade-plan 仍完整检查。

生产新增服务、常驻进程、数据库、Registry、系统包和额外状态文件均为 0。只更新既有 Git 源码及运维说明；现有 journal / 日志可多输出一份受限诊断。现有未完成请求和历史证据必须先按原恢复规程处理，不能清空后直接重试。旧 CLI 自身在获取修复前就阻断时，仍使用既有经审核 source-only adoption，不绕过其独立证据与审批。

当前判断：本地与外部 Ubuntu 客户端 / 内核关键路径验证通过，可以进入管理员审核本次 V1 补丁；真实 Rootless daemon、业务数据库和生产发布仍无本次实测结论，不能宣称生产部署已经稳定成功。没有 V2 后续开发，也不增加 M3 或新的部署架构。
