# 历史控制平面机制的保留、合并与退役清单

本清单是后续迁移处置计划，当前没有删除或替换以下文件。安全约束可以重写为较小协议，历史证据不能删除来制造“干净状态”。退役 gate 见 [里程碑与验收](07-migration-milestones-and-acceptance.md)。

## 按机制处置

| 现有机制 / 主要文件 | V2 处置 | 为什么 | 最早允许移出运行路径 |
| --- | --- | --- | --- |
| 应用仓库 CLI：`scripts/deploy-production.mjs`、package 的 production deploy scripts | 替换为独立 CLI；V1 先保留只读 / 独立归档工具 | 普通业务发布不能更换执行器；避免多命令各自解释状态 | M5 完成单写入口移交；删代码需 M6 |
| 更新源码再移交：`deploy-production-bootstrap.mjs`、`target-controller-source.mjs`、`deployment-git.mjs` | V2 core 删除整个职责 | CI 制品无生产 Git，也无需 clean tree / main / origin / fast-forward | M5 切换后不引用，M6 才删除 |
| 目标入口协议：`controller-entry.mjs`、`legacy-handoff.mjs` | 不迁入 V2；只留 V1 边界工具 | 一个固定 Agent 无需跨源码父子进程证明、旧 bootstrap 来源或 handoff nonce | M6，原 V1 未解决操作全部有真实结论 |
| 应用源码 runner：`deploy-production-runner.mjs`、`production-deploy-workflow.mjs`、`production-deploy-core.mjs` | 重写为状态 core + 受限平台 adapter；不平移大 runner | 分离纯转移、真实执行和来源校验；生产构建 / 初始化退出普通路径 | M3 在 VM 验证；生产运行切换为 M5，删除为 M6 |
| 多状态文件 / finalization：`deployment-state-write.mjs`、`deployment-finalization.mjs`、latest / accepted / request archive | 合并为单库事务；JSON 仅输出 | 删除终态与 accepted 分别提交、改名请求才能完成的协议 | M5 导入后；历史原件只读留存 |
| 早期专门归档：`early-request-archive.mjs` | V2 新请求不需要；V1 遗留处理保留 | 准入与终态事务化，不再通过挪请求解锁下一次发布 | M6，不能以 V2 exporter 替代旧证据核验 |
| 跨版本 legacy transition / source adoption：`deploy-legacy-transition.mjs`、`legacy-transition-host.mjs`、`legacy-transition-archive.mjs` | 收敛为一次性 V1 导入 / 只读分析包；不进入 core | 源码升级和历史入口证据是 V1 特有边界 | M6，确认无待处理旧请求与 adoption |
| 历史源码 / unit 哈希兼容目录：`host-compatibility-catalog.json`、`host-trust.mjs` | V2 不携带；V1 迁移工具冻结所需版本 | 以独立签名 Agent 协议取代不断增长的历史源码白名单 | M6，原受审包仍应可离线取得 |
| 主机版本大合约：`host-runtime-contract.json`、`lumina-host-contract.mjs`、`check-host-runtime-contract.mjs` | 拆成私有 runtime、site policy、按需 capability profile；保留应用对齐职责 | 复用现有软件，检查不变成重装 / 数据根迁移；P0 不代替外部系统测试 | M3 新模型成立；旧 CI 引用到 M6 才移除 |
| Host snapshot / capability：`host-preflight.mjs`、`host-capabilities.mjs` | 重写为纯观测结果 + 规则；保留真实 Compose 安全语义测试 | 删除 safe false 和泛化状态；保留必要隔离 / 安全字段 | M3；旧 V1 使用期间不得直接删改守卫 |
| 生产 build proxy / Buildx ownership：`docker-build-proxy.mjs`、builder marker / replace | 从日常部署移除；需要时留在独立 CI builder / 旧维护工具 | 目标为已构建镜像，不该被缓存、builder image 或 host network build 需求阻断 | M5 起日常路径不引用；既有 builder 是否退役由管理员单独决定 |
| 主机安装 / builder upgrade：`install-host-maintenance.mjs`、`lumina-host-upgrade.mjs` | 保留 V1 维护边界；V2 installer 只管理 Agent 包，不复用 builder replacement 状态机 | 主机维护与部署器安装不是同一个生命周期 | M6 后评估，不能顺带删缓存或更换 Docker |
| 两套清理：`post-deployment-cleanup.mjs`、`lumina-crm-storage-maintenance.mjs` | 发布不等待 GC；新系统仅保留一个项目范围 GC；BuildKit GC 留给构建环境 | 避免同一保护集和策略多实现，减少接受之后的收尾失败 | 新 GC 独立验收且 V1 停用后 M6；旧计时任务不可擅改 |
| schema evidence / guarded rollback：`deployment-schema.mjs`、`deployment-schema-evidence.mjs` | 保留兼容守卫和真实 ledger；本地 intent 绑定执行，归属不明不伪造 receipt | 控制状态只写 SQLite，不为部署恢复创建业务 PG 控制表；旧镜像存在不等于兼容 | M3 非生产真实 DB 验收；V1 原工具保留 |
| 实际业务迁移：`db-migrate.mjs`、`db-verify-migrations.mjs`、`db/migrations` | 复用 SQL / 既有 ledger 同事务与同一 advisory lock，不以 V2 为由增表 / 角色 | 不改历史 SQL，不将执行器重构变成数据库扩建或状态服务 | 不在删除 / M1 改造范围；M3 验证证据读取 |
| 目标应用 runtime contract / secret-source checks | 保留业务与 secret 边界；校验执行放入已验证镜像，Agent 仅执行固定协议 | 不删密钥独立性、metadata 和 Web / Worker 一致性保障；执行器不 import 业务代码 | M3；禁止以“简化”为由跳过 |
| readiness / queue baseline / public edge：`production-release-health.mjs`、`public-edge-health.mjs` | 合并结果模型、保留独立健康层，增加内容身份 | 不同信号有不同意义，不能把内部健康当最终成功 | M3，真实错误构建 / edge 失败测试通过 |
| Tunnel 诊断：`diagnose-production-tunnel.mjs`、相关 lib | 保留专业只读工具；通用诊断只接收其受限可选结果，不直接搬运 journal parser | 默认部署不管理 edge 基础设施；避免为诊断扩大权限 | 无需随 V2 删除；由独立工具生命周期管理 |
| Compose / 运行 unit：`compose.production.yml`、`lumina-crm.service`、deploy / storage units、sudoers | 旧资产不覆盖；复用现有 systemd，只拟增一个 CRM 按需 unit 与受限应用模型 | 不将历史 Node / 外部 Supabase 方案覆盖当前 Rootless 容器栈；不增加常驻服务 | 非生产先测；后续管理员单独审核，本阶段 / P0 不安装 |
| 备份 / restore-test、Caddy / Tunnel、PG 配置、provision-volumes | 保留独立运行职责 | 不属于部署器重构自动删除 / 重配范围 | 不在本任务默认退役范围 |
| 旧部署 tests / 历史 Git fetch fixture | V1 支持期保留；M6 将历史兼容测试归到冻结迁移包，core 不再要求旧 Git object | 测试应覆盖受支持接口，而非让每次业务 CI 依赖旧交接源码 | M6，迁移包验收和可离线取得条件满足 |
| 现有 Host / deployment 历史计划和验证文档 | 保留为历史；新入口链接 V2，明确适用版本 | 审计链不应因代码退役消失；避免旧 runbook 被误当 V2 操作指令 | 可在 M6 增加 archived / superseded 标签，不删除证据 |

## 不能丢失的安全契约

项目 UID / rootless socket / data-root 隔离，单写者，受信执行来源，最小权限与 secret 分界，readonly / capability / tmpfs / 网络 / 资源控制，数据库 checksum 和事务账本，真实运行身份，schema 兼容，内部与 edge 分开验收，证据不可伪造，这些继续是强制条件。

可删除的是实现这些约束时产生的历史源码依赖、重复状态和重复协调。若某条检查在 V2 不再必要，必须指出导致风险的操作已移出路径，例如移除生产 build 后才可移除 Buildx 阻断，而不是把已有安全检查改成总是 true。

## 退役顺序与完成证据

1. 先新增独立包与测试，V1 文件不动；静态依赖检查确保 V2 无反向 import。
2. 完成所需外部 Linux / 系统 / 崩溃认证、P0 只读 shadow 和 owner 移交，冻结 V1 写入口；禁止在生产新建 VM / DIND / Runner 或故障注入。缺环境保留 NOT_RUN，不弱化 gate。
3. 删除新 Agent 对旧机制的依赖，再更新应用 / Agent CI、文档和管理员受审入口。清理旧源码前列出所有引用、旧回退资格和未解决记录。
4. M6 仅按批准的文件列表移除仓库代码 / workflow 依赖；不等于生产服务器卸载，不触发远端文件删除、历史重写、卷 / 镜像 / 数据清理。
5. 原生产 evidence 依管理员留存政策保存，public 仓库仅保留最小化设计 / 结论。确认不再需要的私有副本另行授权清理，不能通过 Git 提交处理真实生产材料。

完成证据包括：V2 import / 动态执行图不含旧控制平面；受支持版本矩阵通过；新应用 CI 不再 fetch 历史控制器提交；状态只从 V2 store 解释；管理员确认 V1 无写入资格；文档与实际入口一致。缺一项，清单仍是计划，不能标记已删除 / 已迁移。
