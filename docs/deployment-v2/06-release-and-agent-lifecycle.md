# 版本化制品与独立 Agent 安装、升级和回退

这是 M0 v0.2 待实现的正式发行和安装规范，首选按需 systemd Agent。[M1 运输实验](m1/transport-decision.md) 仅验证虚构密钥与小型 OCI 内容，没有正式 Agent 包 / 信任根 / installer；本阶段 [生产实际增量为零](m1/production-additions.json)。真实制品、运输适配器、非生产 Linux 报告和管理员操作单仍留在后续里程碑，不安装、替换 V1 或创建生产状态。

## 两条独立发布线

| 项目 | 应用发布 | Agent 发布 |
| --- | --- | --- |
| 版本 | CRM semver + commit + release manifest digest | 独立 Agent semver + payload digest |
| 触发 | 业务改动的应用发行 workflow | 受保护 Agent tag 和专用发行 workflow |
| 产物 | 应用 OCI 内容、迁移清单、兼容声明、验证证据 | Agent、私有运行时、协议、固定启动资产、安装 / 回退管理器、SBOM |
| 执行 | 固定版本 Agent 的按需 oneshot worker | 管理员手动运行已验证短安装 / 回退程序 |
| 允许修改 | 本项目 Web / Worker、计划列明的业务迁移、部署状态库 | 版本化 Agent 目录、独立安装记录、Agent active pointer、项目新增服务资产 |
| 禁止修改 | Agent 文件、trust roots、系统依赖、Docker / PostgreSQL / systemd 配置 | 业务 schema、accepted application、现有 Docker / PostgreSQL / 其他项目、既有生产 unit 文件 |

首期可将 Agent 放在本仓库独立目录 / package 中开发，不要求立即拆 Git 仓库；但必须有独立 lockfile、版本、CHANGELOG、测试和 workflow 权限，静态检查禁止 import 应用业务模块。生产包不含源码 checkout，不要求 `git pull`。应用 CI 没有 Agent 发行权限，不因 `.nvmrc` 或业务代码改变而安装新 Agent。

独立生命周期不免除安全维护：Agent 私有 Node / verifier / SQLite 的安全更新需要专用发行、测试和管理员安装。已发行包的内容不可原地修改，修复必须产生新版本和摘要。

## 应用发布 manifest

manifest 采用固定 schema、UTF-8 和确定序列化；签名绑定精确文件字节，引用摘要统一标识算法。必需字段如下，未知执行字段拒绝，不能静默忽略。

| 字段组 | 规范内容 |
| --- | --- |
| 身份 | kind、schemaVersion、release version、release ID、source commit、source repository ID |
| 来源 | 受信 build workflow 身份、provenance 绑定、builder / materials digest、release evidence digest |
| 兼容 | Agent protocol、最低 Agent 版本 / 支持 major、runtime profile、OS / CPU 平台 |
| 内容 | application OCI manifest digest、config digest、layer / rootfs 关联、离线 transport 文件 hash；Web / Worker / migrator 首版共用同一应用内容 |
| 迁移 | migration protocol、逐项 name / checksum、目标 manifest digest、事务性声明、无外部副作用声明 |
| 共存 / 回退 | 经真实测试的旧 / 新 runtime-schema 组合摘要；未声明兼容则按精确 manifest 守卫 |
| 应用运行合约 | 受限 env / secret 合约版本、健康 identity 协议、允许的 service 集合；不含 secret 值 |

manifest 没有 shell、主机安装指令、任意文件路径、systemd 内容或 Agent upgrade URL。依赖声明不能变成自动安装动作。应用配置校验只能在已验证应用镜像中按固定 entrypoint / 网络与 mount 策略执行。

普通发布不再要求重建备份 operations 镜像。备份 / restore-test 工具独立验收；应用 schema 改动需要证明现有备份流程兼容，但不得把基础设施更换塞进 routine apply。

## 内容身份与离线传输

M1/M2 比较并选定具体运输方式：复用 CI artifact 下载后的管理员文件传递、预置离线包，或已经存在且获准的 registry。首版只需实现一个验证完整的可行适配器，不要求同时支持全部模式；不预设新建镜像仓库、对象存储、构建服务器或生产 Runner。生产与开发环境不互通，管理员传递受审内容，不要求生产连接 GitHub / OIDC / 签名服务。

外部 CI 是制品和发行证据的来源，不是 Agent 的常驻网络依赖。受审制品已经传入后，生产执行不能依赖 CI 在线或回连开发机；签名验证材料不足就停止并由管理员补充，不动态搭建服务补齐。

OCI manifest digest、image config digest、Docker image ID 和 tag 是不同身份。Agent 必须验证 descriptor / config / layers 的内容关联与平台，不能把 `.Id` 与 OCI manifest digest 直接比较，也不能因 tag / revision label 相同就信任镜像。

离线包先验证 manifest / transport hash，再验证镜像内容图，最后导入。M1 在外部调查可行性，M2 固定候选格式，M3 在目标包线的非生产 Linux / Rootless 环境执行完整 load / deploy。P0 只读适配不能用生产 load 测兼容。若 RepoDigests 不可用，须用已验证内容图与实际 config ID / rootfs diff IDs 建立可检查绑定；未实测则该运输能力 NOT_RUN，不临时安装工具或回到生产 build。

所有长期引用以 digest 为准。可选 tag 仅用于显示。运行容器的实际 image identity、manifest 绑定、应用自身 release identity 都应一致；Web 与 Worker 不得只报告同 semver 作为接受证明。

## Agent 发行包

规范包至少包含：

- `agent-manifest.json`：Agent version、payload hash、每文件 hash、入口、平台、私有 Node / SQLite / verifier 版本、协议范围、store 读写 epoch、最低 installer 版本。
- 内容寻址 payload：Agent / CLI、私有 Node 24 运行时、受限 verifier、公共协议与安全策略；无应用源码、生产配置或凭据。
- 独立安装 / 回退短程序、固定启动器与一个 CRM 专属 oneshot user unit 候选；清单标明 owner / mode，不覆盖 V1 unit，不增加 daemon / timer / API socket。
- SBOM、license、来源 / build provenance、L2 / L3 compatibility summary 与完整环境锁 digest、签名 bundle 和使用说明。

包必须同时可验证来源、完整性、兼容性。SHA-256 只能证明与给定内容一致，不能独立证明发布者身份。

发行使用固定受保护 workflow 的 Sigstore provenance / signature bundle；离线验证必须携带受信根、签名证明和精确身份政策。审核 repo 的稳定 repository ID、OIDC issuer、workflow / ref 身份、source commit、subject digest 与受保护 tag，不仅比较 repository 名称。GitHub 离线文档说明名称可重用，应额外核对 repository ID。[离线 attestation 验证与身份限制](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)

Sigstore bundle 可包含离线验证材料，实际 verifier 与选定运输路径仍须外部 Linux 测试；官网支持不等于该候选已经验证。[Sigstore bundle 与本地验证](https://docs.sigstore.dev/cosign/verifying/verify/)

管理员先独立建立 trust root / verifier 信任；不能先执行未知包内 installer，再让它证明自身可信。首次包需在可信环境核验签名与来源，通过独立受控渠道给出管理员批准的 payload / installer digest，生产再次核对传输内容。后续包由已经受信的 installer / verifier 验证。

信任材料使用独立版本、有效期和撤销快照。离线主机只能知道已导入的撤销信息，不能声称实时撤销检查。过期、未知时间、身份不符或材料不足均停止安装，由管理员补充受审材料；不自动联网刷新、不使用忽略签名 / claim 的 bypass。密钥轮换和信任根替换需另行明确授权。

## 安装布局与激活真相

拟定布局均为设计路径：

| 路径 | 内容 / 权限 |
| --- | --- |
| `/opt/lumina-deployment-agent/releases/<payload-digest>/` | root 所有的只读完整版本；私有 runtime 和 Agent 一起冻结 |
| `/opt/lumina-deployment-agent/current` | 唯一 active pointer，root 所有的受控 symlink，只允许指向上述 release 目录 |
| `/etc/lumina-deployment-agent/site.json`、`trust.json` | 两个受审配置文件；root 所有，项目身份只读所需字段；不含导出的真实环境材料 |
| `/usr/local/libexec/lumina-deployment-v2` | 一个 root 所有的固定小启动器；持锁后解析 current 一次，执行同一 immutable 目录内的 runtime / entry，不使用应用源码 |
| `/var/lib/lumina-crm/deployment-v2/` | 项目专属 `state.sqlite`、必要 `state.sqlite-journal`、固定 `write.lock` 和有界暂存，不使用业务 PG |
| 项目 user manager 的 `lumina-crm-deployment-v2.service` | 一个新 CRM oneshot user unit；实际安装位置由受审 policy 固定，不改既有 unit |
| 管理员安装日志目录 | 一个当前安装 journal 与受限历史；root 所有 0700，只记录安装 intent / pointer / 核验事实 |

安装 receipt 是 pointer 与实际执行版本的证据，不与 pointer 竞争。路径 / mode 在非生产 Linux 冻结；启动器不能多次解析 mutable current 导致 Node / entry 混版，也不能接受任意 shell / unit 参数。不新增 PID 文件、daemon socket、常驻循环或控制平面 PostgreSQL 表。

首次安装只创建审核过的 V2 专属资产，复用已存在的项目身份 / rootless 环境。缺少 prerequisites 就停止并列出条件。不得安装或替换服务器全局 Node、Docker、PostgreSQL、systemd；不得修改其他项目。若管理员当前边界不允许创建新项目服务，保持只读 shadow，不绕过限制。

## 生产最小增量与资源预算

以下是未来管理员可审阅的新增清单和候选上限，不是已测开销。P0 只读适配只临时运行诊断并写指定报告，不创建下面的安装 / 状态资产。所有安装和真实部署需 M5 独立批准。

| 增量 | 数量 / 生命周期 | 候选资源上限与留存 |
| --- | --- | --- |
| Agent 包与私有 Node / verifier | current + previous 两个不可变版本；升级暂时多一个 candidate | 单版本解包不超过 384 MiB；常备不超过 768 MiB；不安装全局 Node / npm |
| active pointer、固定启动器、site / trust 配置 | 一个 pointer、一个小启动器、两个配置文件 | 启动器目标不超过 4 KiB，配置合计不超过 1 MiB；无真实 secret / 原始日志 |
| 新 systemd unit | 一个 CRM user oneshot unit | Type=oneshot、RemainAfterExit=no、Restart=no；无新 socket / timer / 常驻 manager |
| 控制状态 | 一个 SQLite 文件和一个固定写锁；事务中可出现 journal | state + 内联最小证据 64 MiB 告警、128 MiB 准入上限；为 journal / 最后一条结果保留空间；不保存业务行 |
| 安装 / 最小运行记录 | 一个当前安装 journal；完成历史限量导出 | 本地运行 / 安装记录合计候选 16 MiB；未解决事件不自动删除；不调全局 journald 留存 |
| 验证 / 安装进程 | 管理员按需短进程，结束即退出 | 与 worker 串行，无常驻 installer / 更新检查进程 |
| Agent worker | 一次发布 / reconcile / accept 期间一份；空闲为 0 | 候选 CPUQuota=100%、MemoryMax=512 MiB、TasksMax=64；顺序子进程，需在 L2 实测有效 |
| worker 时限 | 每个批准计划独立 deadline | 候选默认 15 分钟；oneshot 显式 TimeoutStartSec，停止等待 30 秒；较长业务迁移需先重新计划，不无限等待 |
| 诊断工具 | 独立签名短程序，可复用已验证私有 runtime；未安装 Agent 时用受审临时包 | 候选 RSS 128 MiB、45 秒、输出 1 MiB；无需安装服务；临时包空间计入总预算 |
| 应用制品暂存 | 最多一个候选运输包及必要 scratch | 大小由签名 manifest 与 M1/M2 适配器给出 A / U；无默认新 registry、服务器或 builder |

不含应用制品和 Docker layer 的 V2 专属总占用峰值预算为 2 GiB，包含当前 / 回退 / 升级候选、state / journal、受限日志和临时诊断包；这是待测上限，不是必须预分配的保留盘。达到 state 高水位先告警，准入前为后续结果留出空间；不足就拒绝新操作，不能自动清业务库或删除未解决证据。

应用发布还必须计算 A=候选运输包、U=验证 / 解包 scratch 峰值、D=既有 CRM daemon 新增解包 layer / 容器空间，以及结果写入安全余量 R。总占用评估不能只写“SQLite 很小”：额外所需 free space 至少覆盖该操作尚需新增的固定预算、A / U / D 和 R，已占用内容不重复计算。上限由外部实测与现场只读 statfs 联合检查，不默认压缩包大小等于 Docker 解包占用。

Agent unit 的 CPU / RAM 限制不自动约束既有 Docker daemon、容器和 PostgreSQL；M3 必须另测 D 和这些间接峰值，再给真实发布安排窗口。不得为满足预算更改现有 daemon / data-root、邻居限额、全局缓存策略或删除旧 BuildKit。超预算先优化或拒绝，不转移成新增基础设施。

独立 SQLite 文件也不等于物理磁盘隔离。控制状态不占业务 PostgreSQL 的连接 / 表 / 锁，但仍有同机 I/O；采用小事务、限量证据和单并发控制开销，外部测量后才给出预算结论，不承诺未经测量的零争用，不为此新增生产存储服务或迁移数据根。

与既有 CRM 部署目录、业务数据库、Docker 数据根和其他项目保持独立。V2 的唯一 mutable 控制来源仍只有 SQLite；暂存包、安装 journal 和导出均不是另一个 accepted 真相。

## 独立升级事务

安装器属于独立的文件激活域，不是第二套应用部署状态机。安装日志不得写 application accepted pointer、标记业务迁移成功或归档应用请求。

1. **Plan / verify**：验证当前 installer 身份、新包全部签名 / hash / 平台 / 协议、space 与 scope；列出旧 / 新版本、文件变更、store 兼容和具体回退资格。
2. **Stage**：在同一受控文件系统的临时目录解包，拒绝 traversal、link escape、设备文件、setuid、未列文件；核实每个文件后 fsync 并原子固定 release 目录。
3. **Quiesce**：取得与 CLI / worker 相同的固定项目写锁阻止新准入，确认 oneshot 无运行或排队中的旧执行、无仍活跃的外部副作用。制作一致 store 取证备份，不公开原始材料；不依赖暂停常驻 daemon。
4. **Activate intent**：先落盘旧 / 新 pointer 和验证摘要；原子 rename 切换唯一 pointer 并 fsync 父目录。不要分别改多份 active version 文件。
5. **Verify**：以项目身份执行新版本有界只读 doctor，核对启动器 / payload / store epoch 和新 unit 元数据，不启动生产测试任务。真正的 oneshot 派发、锁交接与异常退出由同 digest 的外部 L2 / L3 证据覆盖；现场只读匹配不冒充重新执行过的生命周期认证。
6. **Complete**：记录安装已核验、业务尚未执行，以及退出后零新增常驻进程，完成 journal 后释放锁。升级后 apply 必须重核 Agent digest / 计划；首次真实执行另需批准，不消费旧 grant、不自动恢复任务。

初版 Agent `1.x` 固定 store epoch=1，只允许向后可读写的新增字段 / 表，禁止破坏性格式迁移。安装器不能隐式迁移业务 schema。需要不兼容 store 格式时必须另立有明确维护窗口和迁移 / 回退方案的版本里程碑。

正常升级要求无未解决操作。紧急恢复升级仅允许新旧版本都理解当前 store epoch、既有迁移账本证据和原 action 类型，并经批准以 recovery-only 短程序运行；只采证 / reconcile，后续副作用另行计划。升级不能解除未知操作或向业务 PG 新建控制表。

## 失败与回退判定

| 故障位置 | 允许动作 | 禁止动作 |
| --- | --- | --- |
| 签名 / hash / schema / 来源失败 | 拒绝，旧版本 / unit 保持原样 | 执行新 installer hook、忽略签名 |
| Stage 未完成 | 删除经确认属于本次操作的临时目录或保留取证；旧 pointer 不变 | 删除 release 历史、清理卷 |
| pointer intent 后崩溃 | 先读取真实 pointer / 文件 / 服务身份，继续核验或回到明确旧版本 | 仅按日志 stage 猜测当前版本 |
| 新 Agent 只读 doctor 失败且旧版兼容当前 store | 原子恢复旧 pointer，核验旧版只读状态和退出；当前 store 保留 | 用旧备份覆盖后来状态或启动常驻进程掩盖失败 |
| store epoch / 未解决操作不被旧版本支持 | 保持维护 / recovery-only，向前修复 Agent | 强制降级、删 store、重放迁移 |
| Agent 回退完成 | 应用运行与 acceptedRelease 不变；记录 Agent 回退结果 | 同时回退应用、数据库或系统依赖 |

Agent 回退和应用回退始终是两件事。应用回退沿用 [真实 schema 兼容与恢复协议](03-state-machine-and-recovery.md)，不因 Agent 二进制恢复就重复旧发布。

## 发行门槛

受审来源 / SBOM、私有 runtime、签名正负例、选定制品运输、外部 L2 / L3 的目标包线 / Rootless / oneshot / cgroup / 重启证据、相邻版本升降级、资源实测与状态恢复都属于生产写入版门槛。不强制新 VM / 服务器的形态；缺基础设施记 NOT_RUN，暂停生产发行，不拿容器 / Mock 或 P0 只读结果替代。

新 Agent 版本进入生产还需管理员审阅准确包 digest、兼容报告、当前只读诊断、变更计划和回退资格。普通应用 release workflow 永远不能替管理员完成这一步。
