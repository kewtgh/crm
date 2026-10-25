# V1 / V2 并行验证、迁移里程碑与最终验收

本计划为 M0 v0.2 修订，仍未开始实现。M1 的范围是外部验证可行性、按需执行与只读诊断；不在生产建 VM / DIND / Runner，也不预设新构建服务器或镜像仓库。所有 V2 命令仍是设计名称。

## 迁移原则

- 并行意味着 V1 继续原有写入、V2 只读 shadow，或两个系统各自在独立虚构测试环境写入；不允许对同一业务库双跑迁移来比较结果。
- V1 文件、状态、receipt、日志和旧工具留存，不能通过删除 pending request、改 latest、伪造 entry receipt 或重写 migration ledger“清场”。
- V2 切换是控制平面所有权移交，不自动变更 PostgreSQL、Docker、既有 systemd 或其他项目。应用版本和 Agent 版本分别接受。
- 数据库副作用不随控制平面切换回滚。V2 已写入业务状态后，回到 V1 也必须重新证明 V1 理解当前 schema / runtime / 未解决操作。

## 单写入门禁：不能只靠约定或旧锁

V1 已使用 admission、deploy、maintenance 锁；V2 core 使用一个项目写锁。过渡适配器可按 V1 原定顺序同时取得旧锁，防止正常入口并发，但这只能证明互斥，不能永久撤销 V1 的发布资格，也不能证明 Agent 崩溃后 daemon / DB 副作用已结束。

生产切换必须有管理员管理的单一发布授权入口及 owner epoch，确保 V1 不再有可独立发起写入的授权路径。V2 准入同时检查 owner epoch、原 V1 无活动 / 未解决操作、实际 runtime / schema 与导入基线一致。任何历史任务可能仍在执行，先核实，不能以锁可取得代替副作用已结束。

按需 Agent 空闲退出，不能用“常驻进程永远持锁”代替上述 fence，也不能暗增 guardian daemon。CLI 与 worker 共用锁只解决 V2 写入串行化；V1 授权退出要有独立、最小、管理员批准的控制入口移交，并覆盖两个进程都不运行的空闲 / 重启 / 升级窗口。

这是 M5 硬门槛：fence 在非生产 Linux 进行 V1 / V2 运行、空闲、停止、崩溃、重启和升级窗口的真实负例。不能只写 V1 不读取的 owner 文件，不能只看两个 systemd unit 不同时 active，也不能为验证在生产启动竞争部署。

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

P0 只读适配不连业务数据库、不导入状态，不能单独生成完整可写 baseline。迁移账本等证据来自已有受审记录，或后续 M5 单独批准的真实移交动作；不能借 baseline 名义在生产执行额外测试或补写回执。

导入器仅在持锁、无活动副作用、实际基线未变且 owner 已移交后，在 V2 store 一次事务记录 `IMPORTED_V1_BASELINE` 与来源。它不是一次新发布，不产生虚构的 V2 steps / migration receipts / CI provenance。已有 V1 本地构建无法取得签名来源时标记 `ADMIN_ATTESTED_LEGACY`，不得标成受信 CI 发行制品。

导入的接受基线只代表管理员核实过的历史 / 当前事实。下一次 V2 发布仍需新的签名制品、schema / runtime 检查和协议兼容；遗留镜像是否可作为补偿目标必须单独证明。导入器是一次性边界工具，不进入 Agent 每次发布的启动依赖。

## 独立里程碑

| 里程碑 | 具体交付 | 进入条件 | 必须验收 / 退出条件 | 当前状态 |
| --- | --- | --- | --- | --- |
| M0 / 设计基线 | 审计与 v0.2 约束、按需方案、文件 / 进程 / 磁盘清单、新版 M1 | 仓库与管理员约束 | 文档 / 隐私检查通过；无 V1、CI 代码或生产改动 | 本次仅修订文档 |
| M1 / 外部可行性与诊断 | 下述输出清单、capability inventory、按需生命周期 harness、诊断 MVP、运输比较与预算 | 单独批准实施与可用外部资源 / 时间，不需生产访问 | 按条记录真实 L0/L1/L2/L3 与 NOT_RUN；诊断只读 / 隐私；缺资源如实阻断对应认证，不要求新服务器 | 未开始 |
| M2 / 稳定 Agent 与发行骨架 | 独立 package / runtime、oneshot / store / grant、选定运输适配器、verifier、安装回退 | M1 明确方案与证据缺口；可进行不宣称生产兼容的开发 | L0/L1、签名负例、idempotency / CAS、单一状态；不引入 API daemon、业务 PG 状态或隐式系统安装 | 未开始 |
| M3 / 非生产完整执行与恢复 | 目标包线 Linux / Rootless 上应用发布、既有 ledger 证据恢复、跨版本 / reboot / crash / 预算 | 对应 L2/L3 环境实际可用；候选摘要固定 | mandatory 真测全通过；零未知重放；当前 store 保留；虚构邻居不变；缺环境 NOT_RUN 则不得进生产写入 | 未开始 |
| M4 / V1 对照与 P0 shadow | 非生产虚构 V1/V2 对照；生产仅管理员手动受审只读诊断，离线比较 | 外部证据 / collector 安全性满足其范围；不增加生产测试资源 | 安全结论可解释；P0 无数据库连接 / state / unit 写入；原 V1 保留 | 未授权、未开始 |
| M5 / 管理员真实业务移交 | P0 匹配、最小 CRM 程序 / oneshot / SQLite 增量、有效 fence、真实发布操作单 | 外部发行门槛全通过；管理员另批具体安装和业务变更；不修改邻居或重装主机组件 | 实际接受；空闲零新增进程；无常规生产构建 / release gate；失败保留证据并停止，不以生产故障注入补测 | 未授权、未开始 |
| M6 / 收敛与退役 | 默认入口切 V2；V1 工具冻结只读；按清单拆旧依赖 / CI；保留必要证据 | 试点达标，管理员批准退役范围和留存期限 | 不再依赖历史源码目录；所有引用与回退政策更新；删除内容不含不可替代证据；无共享组件变动 | 未授权、未开始 |

M1/M2 可并行推进文档 / alpha，不能越过缺失的 L2/L3 生产发行门槛。缺外部资源允许交付完整缺口报告，但不代表相关兼容认证通过。每个实施里程碑独立验收 / 提交；CRM 版本不因 M0 文档修订或 Agent pre-release 改动。

## 新版 M1 实施范围与交付

本节是下一阶段计划，不是当前已开始的代码工作。最小输出如下：

| 交付 | 内容 | 具体退出条件 |
| --- | --- | --- |
| `capability-inventory` 与 evidence index | 可复用开发 / 外部 CI / 非生产 Linux 能力、环境锁、每项测试位置与 NOT_RUN 原因 | 不把生产列为测试 runner；缺 user manager / reboot / 包版本如实显示，不采购隐含依赖 |
| `lifecycle-decision` | 固定 oneshot harness、真实 SQLite / Linux 锁 / 一次性 grant、CLI detach、exit / timeout、重启恢复比较 | 按 [M1-02 至 M1-07](04-environment-and-ci.md#按需生命周期与真实测试矩阵) 逐项真测；未实测不称通过；没有证据不加常驻服务 |
| 诊断 schema / MVP / 脱敏 fixture | 默认无 DB / 外网、生产只读 scope、NOT_INSTALLED 与动态能力 NOT_RUN、固定白名单 | L0/L1 的只读 API / 文件与隐私负例通过；所有实际执行路径范围明确，未测范围不建议生产运行 |
| `transport-decision` | 比较已存在文件传递 / CI artifact / 已有 registry，来源验证、Docker 内容身份和空间公式 | 至少选出可外部验证的候选；不要求新仓库 / 服务器；M2 固定、M3 完整运行 |
| `production-additions` 与资源实测 | 逐文件 owner / mode / digest、一个 unit、短进程树、RSS / CPU / task / state / transport 峰值 | 对照 [生产最小增量](06-release-and-agent-lifecycle.md#生产最小增量与资源预算)，解释偏差；未知实测保留 NOT_RUN |
| `m1-acceptance` | executed / result / scope / evidence digest，已通过与被阻断项，后续 M2/M3 输入 | 正式 gate 不包含“Mock 代真实环境”；无生产命令自动执行，无 V1 运行路径替换 |

M1 可以开发并测试独立 collector / 小型 lifecycle harness，不实现或安装完整生产 Agent，不改 V1，也不创建新业务数据库 / 回执表。完整迁移与应用副作用验证在 M3 用虚构 PostgreSQL，既有业务账本的读取不能用 Mock 冒充真实事务结果。

## M1 资源预算与验收

预算是上限候选，需先核实已有资源；本阶段没有启动 job 或开通资源。

| 工作 | 资源位置 / 预算 | 验收或停止点 |
| --- | --- | --- |
| 文档 / 协议 / 隐私 L0 | 现有开发机 Node 24；每个可选检查 55 秒 watchdog；scratch 1 GiB | 范围通过即停止，不扩为全应用构建 / 浏览器 / DB 回归 |
| 原生 Compose / Linux L1 | 现有外部 CI，候选 2 vCPU / 4 GiB / scratch 12 GiB；job 20 分钟 | 记录实际 runner / plugin / daemon；不符合目标包则限定认证范围 |
| oneshot / Rootless / cgroup L2 | 可用或另行批准的非生产 Linux，候选 4 vCPU / 8 GiB / scratch 20 GiB；每组 30 分钟 | 真实 detach / exit / 并发 / 限额；没有环境就 NOT_RUN，不到生产执行 |
| reboot / power loss L3 | 可丢弃环境或明确专用非生产机器；每组 45 分钟；VM 如使用不超过 40 GiB | 不重启共享 runner 或生产；故障恢复要有真实磁盘 / OS 证据 |
| P0 将来只读适配 | 不建测试设施、不装 unit / store；45 秒、候选 RSS 128 MiB、输出 1 MiB | 先通过 collector 外部只读 / 预算验证，管理员另批手动运行；不能补 L2/L3 |

预计超过 60 秒的可选 QA 事先单独确认范围与预算。预算超限或外部环境不可用时先报告 / 收敛；不增加生产负担、不把未执行写成 skip 后继续发行。M1 报告应同时给出“交付是否完整”和“兼容能力是否获证”，两者不能混为一个通过标志。

M1 采纳按需方案需要：真实 unit 生命周期和零空闲新增进程、持锁串行与单次 grant、终端断开不丢请求、重启后显式恢复且无未知重放。仅静态可行时结论为 DESIGN_ONLY / NOT_RUN；没有必要性证据不批准常驻替代。即使上述通过，完整应用迁移 / 激活和生产 fence 仍需 M3/M5 独立证据。

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
| V2 已迁移或开始激活 | 按需 recovery-only，核实真实 ledger / runtime，归属不明则显式恢复计划 | 不启动 V1 重跑同一发布，不反向迁移或补写归属 |
| V2 Agent 故障、应用未受损 | 用兼容当前 store 的旧 Agent 包恢复控制器 | 不恢复旧 store、旧数据库或旧 accepted JSON |
| 要求返回 V1 但其工具不理解当前 schema / runtime | 停止返回，另做版本兼容 / 恢复设计 | “保留 V1 文件”不等于 V1 随时安全接管 |

管理员操作单必须是特定制品和现场证据的产物，列出每步前提、动作、副作用、预期证据、失败停止点和回退资格。本阶段不提供会直接修改生产的通用复制命令，也不承诺“任何阶段一条命令回退”。

## 最终验收标准

以下是后续可核验的门槛，不是本阶段已通过的结果：

| 目标 | 验收证据 |
| --- | --- |
| 稳定执行器 | 应用发布前后 Agent payload / runtime / active pointer 完全相同；应用工作流无升级权限 |
| 日常路径简化 | 真实发布跟踪中 Git、npm ci、Buildx、release gate 和系统安装次数为 0；不改既有主机配置 / 邻居；不要求新 registry 或服务器 |
| 低资源 / 按需 | 一个 CRM oneshot unit、无 API socket / timer、空闲新增进程为 0；实测启动 / 退出 / CLI detach / reboot、峰值和 timeout 满足预算；不假设限制覆盖 Docker daemon |
| 存储隔离 | 一份专属 SQLite、必要 journal / lock；不新增数据库实例、服务或 CRM / 邻居 PG 控制状态表；恢复仍可读取真实业务迁移账本 |
| 准确预检 | 所有负例报告首因、stage、errno / exit / parser 类别；依赖检查 NOT_RUN；不以推荐版本或 Buildx 缺失误阻断镜像发布 |
| 单一状态 | 全部 crash failpoint 后 accepted pointer 与终态同事务；导出失败不影响接受；没有可写 last-success / latest 真相副本 |
| 真实恢复 | COMMIT 后本地落盘前断电、部分迁移 / 激活等场景全部真实执行；已提交迁移执行次数为 1；不明结果阻断后续副作用 |
| 环境兼容 | 外部 L1 与目标 Ubuntu 包线非生产 L2/L3 能力逐项获证，再加 P0 只读匹配；缺基础设施为 NOT_RUN 并阻断，不在生产建 VM / DIND / Runner 补测 |
| 日常可靠性 | 固定候选在干净非生产 Linux 连续 10 次合法发布接受；另有真实冷启动 / 崩溃负例和安全停止证据；不要求新增特定 VM / 构建服务器 |
| 真实接受 | Web / Worker 内容身份、schema、内部 readiness / 队列、edge identity 都核实；同 version 错构建不得通过 |
| 独立升级 | 纯离线来源验证；正常 / 失败 Agent 升级与兼容回退通过；应用状态不变；不兼容 epoch 拒绝回退 |
| 诊断隐私 | 外部只读 API / 文件与泄漏测试；P0 默认无 DB / 外网、不创建状态 / unit，动态能力 NOT_RUN，compatibilityCertified=false |
| 可安全移交 | V1 在 V2 运行 / 停止 / 崩溃 / 升级窗口的禁止写入证据；基线导入不伪造 V2 provenance / receipt |
| 生产试点 | 管理员核实的接受记录；至少 3 次自然发生、独立批准的正常发布无控制平面故障，再审阅是否退役 V1；不为凑数触发生产迁移 / 故障注入 |

10 次非生产成功和 3 次自然业务发布只是门槛，不是成功率统计证明。生产不为凑次数或补外部证据进行迁移 / 故障注入 / reboot。持续区分业务 SQL、网络和控制平面失败类别。

## 第一阶段实际验证记录

以下是 M0 v0.1（`97bbb7c`）的历史记录，不作为 v0.2 本次检查结果或运行认证。原审计审阅 CLI / bootstrap / runner、主机合约、状态 / 恢复、部署资产、测试和 CI；本次不重复扩展仓库审计。

2026-10-25 在仓库固定 Node `24.22.1` 下完成以下本地检查：

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 新设计文档结构 / 本地链接 / 示例 | 9 份文档、65 个本地链接、28 张表格、1 个 JSON 示例全部通过 | 包括标题、fence、列数、相对链接 / heading、JSON 语法、尾空白与本机路径检查；不是 V2 功能测试 |
| 公开仓库隐私与 artifact 契约 | 14 passed、0 failed、0 skipped；约 2.2 秒 | `node scripts/run-bounded.mjs --label deployment-v2-design-privacy --timeout-seconds 55 --idle-seconds 45 --heartbeat-seconds 15 -- node --test --test-isolation=none tests/public-repository-privacy.test.mjs tests/public-ci-artifacts.test.mjs` |
| 设计不变量交叉审阅 | 已完成 | 接受与终态同事务、不可覆写旧 step 结果、迁移提交窗口、离线镜像身份、Agent 回退保留当前 store、V1 fence 门槛 |
| 文件变更 / whitespace | 文档范围；`git diff --check` 通过 | 仅本目录与现有部署文档新增导航，无执行路径改动 |

未运行应用构建、浏览器或整套数据库测试，因为没有改动应用行为。未创建或执行 Ubuntu VM，未验证生产包安装状态，未接触生产；这些结果仍为 NOT_RUN，不能从上述本地检查推导。

该阶段无 CRM 版本升级、无 V1 运行文件变更、无 Agent 制品安装，未开始 M1。

## M0 v0.2 本次验证记录

本次仅修订本目录 9 份设计文档。生产身份的具体绑定保存在 Git 忽略的私有适配材料，公开设计按确切 policy 匹配而不披露原始值。

2026-10-25 使用仓库固定 Node `24.22.1`：文档结构检查通过（9 份文档、74 个本地链接、35 张表格、1 个 JSON 示例），另检查了 P0 scope、capabilities 的 NOT_RUN、compatibilityCertified=false 及 summary 计数一致。相对链接 / heading、fence、尾空白、本机路径和文件变更范围均无问题。

本次隐私检查实际为 14 passed、0 failed、0 skipped，约 1.7 秒；命令为 `node scripts/run-bounded.mjs --label deployment-v2-m0-revision-privacy --timeout-seconds 55 --idle-seconds 45 --heartbeat-seconds 15 -- node --test --test-isolation=none tests/public-repository-privacy.test.mjs tests/public-ci-artifacts.test.mjs`。`git diff --check` 与私有材料的忽略边界检查均通过，不复用 v0.1 历史结果。

外部 L1、真实 L2/L3、P0 生产只读适配均为 NOT_RUN；没有新建 VM、CI Runner、镜像仓库、数据库实例或常驻 Agent，也没有实现 V2、变更 V1 / CI 代码或执行生产命令。后续从新版 M1 的外部能力清单和按需可行性验证开始。
