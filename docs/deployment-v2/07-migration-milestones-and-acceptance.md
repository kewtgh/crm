# V1 / V2 并行验证、迁移里程碑与最终验收

本计划按独立里程碑实施。第一阶段只完成设计，不因本文件存在而启动 M1、安装程序、CI 资源或生产操作。所有 V2 命令仍是设计名称。

## 迁移原则

- 并行意味着 V1 继续原有写入、V2 只读 shadow，或两个系统各自在独立虚构测试环境写入；不允许对同一业务库双跑迁移来比较结果。
- V1 文件、状态、receipt、日志和旧工具留存，不能通过删除 pending request、改 latest、伪造 entry receipt 或重写 migration ledger“清场”。
- V2 切换是控制平面所有权移交，不自动变更 PostgreSQL、Docker、既有 systemd 或其他项目。应用版本和 Agent 版本分别接受。
- 数据库副作用不随控制平面切换回滚。V2 已写入业务状态后，回到 V1 也必须重新证明 V1 理解当前 schema / runtime / 未解决操作。

## 单写入门禁：不能只靠约定或旧锁

V1 已使用 admission、deploy、maintenance 锁；V2 core 使用一个项目写锁。过渡适配器可按 V1 原定顺序同时取得旧锁，防止正常入口并发，但这只能证明互斥，不能永久撤销 V1 的发布资格，也不能证明 Agent 崩溃后 daemon / DB 副作用已结束。

生产切换必须有管理员管理的单一发布授权入口及 owner epoch，确保 V1 不再有可独立发起写入的授权路径。V2 准入同时检查 owner epoch、原 V1 无活动 / 未解决操作、实际 runtime / schema 与导入基线一致。任何历史任务可能仍在执行，先核实，不能以锁可取得代替副作用已结束。

这是 M5 的硬门槛：需要管理员针对现有权限 / 发布入口证明可执行的 fence 方案，并在真实 VM 进行“V1 在 V2 运行、停止、崩溃、升级窗口均不能另行发起写入”的负例测试。不能只让 V2 写一个 V1 不读取的 owner 文件就宣称互斥完成。

本阶段不假定允许修改或 mask 既有生产 unit、调整 Docker / PostgreSQL、改共享权限或更换主机组件。如果当前“不得修改既有 systemd 等生产组件”的边界下无法撤销 V1 独立写入资格，生产就停留在 SHADOW；后续需另立管理员审核的控制入口移交方案，不能绕过边界上线双写。此限制不阻止开发环境完成 V2，也不授权 Codex 访问生产。

## V1 状态分类与导入协议

| 现场可证明的 V1 情况 | V2 允许动作 | 禁止动作 |
| --- | --- | --- |
| 已接受、无 pending、无活动进程 / 任务，runtime 与 schema 可核实 | 生成只读 baseline / shadow comparison；满足 fence 后一次性导入 | 仅凭 last-success 文件认定运行一致 |
| 有明确早期拒绝且无业务副作用 | 保留原证据；管理员使用原受审 V1 流程解决，再重新采集 | V2 直接改名或删除 request |
| 内部健康、公网未接受 | 保留候选与账本；由 V1 完成原操作的验收或真实恢复 | 在 V2 把候选登记为已接受 |
| 迁移、激活、交接或归档结果不明 | 不导入为可写站点；只读取证 / 人工协调 | 从超时或日志缺失推断 NOT_STARTED |
| accepted / latest / request / runtime 相互矛盾 | 标记 `IMPORT_BLOCKED/EVIDENCE_CONFLICT` | 选择“看起来最新”的文件覆盖其他事实 |
| 原工具无法读取当前 schema 或缺原始证据 | 保持 V1 隔离与只读分析，另立恢复计划 | 补写 V2 migration receipt 冒充过去执行 |

管理员手动生成的 baseline 至少绑定：V1 accepted 记录 hash、原状态目录快照引用、真实 Web / Worker image 身份、迁移账本 digest、受审资源 policy、V1 最后执行身份、采集工具版本、owner 移交批准和时间。真实值只保留在私有操作材料。

导入器仅在持锁、无活动副作用、实际基线未变且 owner 已移交后，在 V2 store 一次事务记录 `IMPORTED_V1_BASELINE` 与来源。它不是一次新发布，不产生虚构的 V2 steps / migration receipts / CI provenance。已有 V1 本地构建无法取得签名来源时标记 `ADMIN_ATTESTED_LEGACY`，不得标成受信 CI 发行制品。

导入的接受基线只代表管理员核实过的历史 / 当前事实。下一次 V2 发布仍需新的签名制品、schema / runtime 检查和协议兼容；遗留镜像是否可作为补偿目标必须单独证明。导入器是一次性边界工具，不进入 Agent 每次发布的启动依赖。

## 独立里程碑

| 里程碑 | 具体交付 | 进入条件 | 必须验收 / 退出条件 | 当前状态 |
| --- | --- | --- | --- | --- |
| M0 / 设计基线 | 本目录审计、模块、状态 / 恢复、环境、诊断、发行、迁移和处置清单 | 仓库可审计 | 文档相互一致、范围与未验证事实明确；无运行路径替换 | 文档完成；未进入实施 |
| M1 / 复现与只读诊断 | 环境锁、Ubuntu VM 构建定义、独立诊断 schema / collector、最小公开报告 | 单独确认实施范围、VM 资源与运行预算；不需生产访问 | 真实目标包 / rootless / systemd / cgroup 可运行；诊断只读 / 脱敏通过；不满足就阻断 M3 | 未开始 |
| M2 / 稳定 Agent 与发行骨架 | 独立 package / version、私有 runtime、受限 CLI / socket、SQLite 状态、artifact verifier、安装 / 回退工具 | 采纳设计基线与协议；M1 提供可测环境或明确并行开发输入 | L0 / L1；签名负例；idempotency / CAS；单一状态；应用 CI 无 Agent 安装权限；不能因此宣称 VM 集成通过 | 未开始 |
| M3 / 完整 VM 执行与恢复 | 镜像运输、受限 Compose adapter、V2 migrator receipt、身份验收、真实崩溃矩阵、跨 Agent 版本测试 | M1 环境已认证，M2 候选制品已绑定 digest | L2 / L3 必需清单全部真实执行；零未知迁移重放；回退兼容与 store 保留；其他项目 canary 不变 | 未开始 |
| M4 / V1 对照与 shadow | V1 独立虚构 VM 对照；只读 baseline importer / comparison；脱敏差异报告 | M3 通过；V1 fixture 可独立复现；管理员自愿提供最小只读诊断时仅离线分析 | 相同条件给出一致安全结论或逐项解释差异；shadow 无业务 / 控制平面写入；原生产脚本完整保留 | 未开始 |
| M5 / 管理员生产试点 | 精确制品 / 来源、现场适配、单写入 fence、一步一证据的移交与恢复操作单 | 管理员单独批准具体窗口和命令；现场无未解决操作；fence 负例通过；边界允许必要 V2 专属资产 | 首次实际接受；无生产构建 / 安装；运行与 state 一致；管理员记录结果；失败按下述矩阵停止 | 未授权、未开始 |
| M6 / 收敛与退役 | 默认入口切 V2；V1 工具冻结只读；按清单拆旧依赖 / CI；保留必要证据 | 试点达标，管理员批准退役范围和留存期限 | 不再依赖历史源码目录；所有引用与回退政策更新；删除内容不含不可替代证据；无共享组件变动 | 未授权、未开始 |

M1 / M2 可以在独立分支并行开发，但 M3 的真实环境门槛不能降级。每一里程碑都有独立审计差异、验收报告、版本和提交；Agent pre-release 使用独立版本号，不能通过提升 CRM 版本伪装部署器发行。

## Shadow 比较规则

比较的是同一脱敏 snapshot / 虚构 VM 场景中的安全结论和准确原因，不要求 V2 复刻所有 V1 布尔值。例如 Buildx 缺失时，V1 的生产构建路径可以阻断，V2 镜像发布不应阻断；此差异应解释为依赖缩减，而非放宽容器安全。

比较必须覆盖主机隔离失配、命令 / parser 失败、未解决迁移、内部与 edge 健康、schema 兼容、锁竞争及 accepted / runtime 漂移。未知不应被 V2 升格为成功。原始诊断只在私有区域，不把真实状态散落在公开审计文件中。

生产 shadow 不运行 migrate、compose up、数据库 bootstrap、镜像 build / pull / load、状态 reconcile 或写入 V1 / V2 authority。生成管理员指定的诊断报告文件是唯一输出。开发环境写入 shadow 测试必须使用隔离副本 / 虚构库，并标记为测试，不能与生产 shadow 混淆。

## 切换失败与回退矩阵

| 切换时点 | 安全动作 | 必须保持 |
| --- | --- | --- |
| V2 仅只读 shadow | 丢弃候选工具或修复开发版本，V1 继续原操作 | 原生产脚本、状态和资源不变 |
| owner 移交前 | 停止试点；V1 仍是唯一写者 | 不导入为 V2 可写，不让两方各自排队 |
| 移交后但 V2 没有业务副作用 | 管理员证明无活跃任务、runtime / schema 仍等于移交基线后，记录 owner 移回 V1 | 两侧移交记录保留；不能只删 V2 store |
| V2 已迁移或开始激活 | 保持 V2 recovery-only，按真实 receipt 向前恢复或已证明兼容的补偿 | 不启动 V1 重跑同一发布，不反向迁移 |
| V2 Agent 故障、应用未受损 | 用兼容当前 store 的旧 Agent 包恢复控制器 | 不恢复旧 store、旧数据库或旧 accepted JSON |
| 要求返回 V1 但其工具不理解当前 schema / runtime | 停止返回，另做版本兼容 / 恢复设计 | “保留 V1 文件”不等于 V1 随时安全接管 |

管理员操作单必须是特定制品和现场证据的产物，列出每步前提、动作、副作用、预期证据、失败停止点和回退资格。本阶段不提供会直接修改生产的通用复制命令，也不承诺“任何阶段一条命令回退”。

## 最终验收标准

以下是后续可核验的门槛，不是本阶段已通过的结果：

| 目标 | 验收证据 |
| --- | --- |
| 稳定执行器 | 应用发布前后 Agent payload / runtime / active pointer 完全相同；应用工作流无升级权限 |
| 日常路径简化 | 真实执行跟踪中 Git、npm、Buildx、系统安装次数为 0；不修改 PostgreSQL / 既有 systemd / 其他项目；无手工删除请求 / 历史归档才能发布 |
| 准确预检 | 所有负例报告首因、stage、errno / exit / parser 类别；依赖检查 NOT_RUN；不以推荐版本或 Buildx 缺失误阻断镜像发布 |
| 单一状态 | 全部 crash failpoint 后 accepted pointer 与终态同事务；导出失败不影响接受；没有可写 last-success / latest 真相副本 |
| 真实恢复 | COMMIT 后本地落盘前断电、部分迁移 / 激活等场景全部真实执行；已提交迁移执行次数为 1；不明结果阻断后续副作用 |
| 环境兼容 | 固定 Ubuntu 26.04 / Ubuntu 包锁上的 L2 / L3 全通过，真实 user systemd / cgroup 限制与重启证据齐全；没有用 Mock 替代的 mandatory skip |
| 日常可靠性 | 同一固定候选在干净 / 冷启动 VM 连续 10 次合法普通发布全部接受；另有独立负例全部按设计安全停止；记录阶段耗时和失败类别 |
| 真实接受 | Web / Worker 内容身份、schema、内部 readiness / 队列、edge identity 都核实；同 version 错构建不得通过 |
| 独立升级 | 纯离线来源验证；正常 / 失败 Agent 升级与兼容回退通过；应用状态不变；不兼容 epoch 拒绝回退 |
| 诊断隐私 | 正向 schema、异常与伪装 version 泄漏测试、只读 API / 文件观测；默认无 DB / 外网，非零结果不被解释成泛化不兼容 |
| 可安全移交 | V1 在 V2 运行 / 停止 / 崩溃 / 升级窗口的禁止写入证据；基线导入不伪造 V2 provenance / receipt |
| 生产试点 | 管理员核实的接受记录；至少 3 次自然发生、独立批准的正常发布无控制平面故障，再审阅是否退役 V1；不为凑数触发生产迁移 / 故障注入 |

10 次 VM 成功和 3 次试点只是发布门槛，不是统计上证明某个成功率。持续记录按阶段区分的失败与耗时，不把业务 SQL 错误、网络故障和控制平面缺陷混成一个不可解释的百分比。

## 第一阶段实际验证记录

已审阅当前 CLI / bootstrap / runner、主机合约与已安装组件边界、源码交接、状态写入与终态归档、schema / 恢复守卫、生产 Compose / systemd 资产、部署测试和现有 CI。审计内容按当前基线保存，并核对公开官方技术资料。

2026-10-25 在仓库固定 Node `24.22.1` 下完成以下本地检查：

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 新设计文档结构 / 本地链接 / 示例 | 9 份文档、65 个本地链接、28 张表格、1 个 JSON 示例全部通过 | 包括标题、fence、列数、相对链接 / heading、JSON 语法、尾空白与本机路径检查；不是 V2 功能测试 |
| 公开仓库隐私与 artifact 契约 | 14 passed、0 failed、0 skipped；约 2.2 秒 | `node scripts/run-bounded.mjs --label deployment-v2-design-privacy --timeout-seconds 55 --idle-seconds 45 --heartbeat-seconds 15 -- node --test --test-isolation=none tests/public-repository-privacy.test.mjs tests/public-ci-artifacts.test.mjs` |
| 设计不变量交叉审阅 | 已完成 | 接受与终态同事务、不可覆写旧 step 结果、迁移提交窗口、离线镜像身份、Agent 回退保留当前 store、V1 fence 门槛 |
| 文件变更 / whitespace | 文档范围；`git diff --check` 通过 | 仅本目录与现有部署文档新增导航，无执行路径改动 |

未运行应用构建、浏览器或整套数据库测试，因为没有改动应用行为。未创建或执行 Ubuntu VM，未验证生产包安装状态，未接触生产；这些结果仍为 NOT_RUN，不能从上述本地检查推导。

本阶段无 CRM 版本升级、无 V1 运行文件变更、无 Agent 制品安装，未开始 M1。后续实施应从 M1 的可重现环境与只读诊断开始，不能跳过环境证据直接用生产排错验证设计。
