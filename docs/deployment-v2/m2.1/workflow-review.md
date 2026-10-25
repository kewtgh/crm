# M2.1 Workflow 执行入口与安全审阅

2026-10-26；审阅对象为本阶段候选 [.github/workflows/deployment-v2-agent.yml](../../../.github/workflows/deployment-v2-agent.yml)。这是运行前审阅，不是动态兼容性证明。

| 边界 | 候选配置 / 结论 |
| --- | --- |
| 实际入口 | 固定 `validation/deployment-v2-m2.1` 分支 push；保留 paths 限定的 PR 与 workflow_dispatch。只有固定分支 push 执行 dynamic-linux；手动 dispatch 当前只执行 native-linux，不能暗中安装 fixture |
| 默认分支可用性 | M2 workflow 尚未进入远端默认分支；不用假设 workflow_dispatch 已注册，获准后由新验证分支 push 注册和执行 |
| 执行身份 | GitHub 托管 Ubuntu 24.04 临时 VM，非 self-hosted；动态操作使用全新 fixture UID，Agent worker 为该 UID 的固定 user oneshot |
| Token / secrets | contents:read；两个 checkout 均 persist-credentials:false；无 secrets、environment、生产 SSH / socket mount / 数据库 URL；harness env -i 只传固定运行元数据和私有 user bus |
| 依赖边界 | Node 固定 .nvmrc 24.22.1；Compose 固定 2.40.3 / SHA-256；虚构 workload 镜像固定 OCI digest。Runner 系统 / Docker 包线浮动，必须记录实际版本，不能认证生产发行版 |
| 权限与临时写入 | 只在托管 VM 分配新用户、linger / user manager、fixture unit、必要 user namespace helper；不改 Docker 系统安装、全局 user@ 模板、sysctl 或 AppArmor；已有名字冲突停止 |
| 超时 | native-linux 20 分钟，dynamic-linux 15 分钟，provision 步骤 8 分钟，harness 300 秒；Agent 原 unit 15 秒 start / 2 秒 stop 不变 |
| 失败与收尾 | 原始输出只写 work/ci-private；EXIT trap 回收 fixture user manager / linger，VM 最终由平台销毁。任务失败保留 exit 非零，always 发布最小化失败摘要；stale SHA / run / attempt 拒绝发布 |
| 公开制品 | 只上传固定 deployment-v2-validation-summary.json，14 天保留；无原始日志、状态库、PTY 输出、环境转储或路径。公开隐私测试对白名单精确匹配，不支持通配符上传 |
| 生产影响 | 没有生产目标参数、真实 CRM 任务、V1 导入或安装入口。生产新增资源 0；此声明范围是执行入口及改动审阅，不是生产现场诊断 |

## Actions 来源固定

通过 GitHub API 读取官方仓库 tag → commit，并在本 workflow 使用完整 commit SHA，减少浮动 tag 影响；不修改其他 workflow。

| 官方 tag | 当前解析 commit |
| --- | --- |
| [actions/checkout v7.0.1](https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [actions/setup-node v7.0.0](https://api.github.com/repos/actions/setup-node/git/ref/tags/v7.0.0) | `820762786026740c76f36085b0efc47a31fe5020` |
| [actions/upload-artifact v7.0.1](https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v7.0.1) | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

源码聚合摘要覆盖 Agent / validation、保留的 M1 和当前 workflow 的已跟踪文件，按排序的路径与各文件 SHA-256 聚合。完整 Git SHA 另外绑定整个仓库提交。runtime-manifest SHA-256 绑定本次构建的逐文件摘要和私有 Node 内容，不能作为独立签名或生产来源 attestation。

当前 GitHub API 中最近的 CRM CI 属于旧应用 SHA `926819e566c5736e83817cd55e45dbf3e5337e66`，不计入 M2.1；没有推送当前候选，也没有当前候选 Run ID。推送和 CI 执行需要用户按本任务明确授权。
