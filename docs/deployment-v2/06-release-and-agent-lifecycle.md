# 版本化制品与独立 Agent 安装、升级和回退

这是待实现的发行和安装规范。不得从本文复制命令去替换现有生产脚本。所有真实包、摘要、签名、管理员操作单和 VM 报告均需后续独立里程碑交付。

## 两条独立发布线

| 项目 | 应用发布 | Agent 发布 |
| --- | --- | --- |
| 版本 | CRM semver + commit + release manifest digest | 独立 Agent semver + payload digest |
| 触发 | 业务改动的应用发行 workflow | 受保护 Agent tag 和专用发行 workflow |
| 产物 | 应用 OCI 内容、迁移清单、兼容声明、验证证据 | Agent、私有运行时、协议、固定启动资产、安装 / 回退管理器、SBOM |
| 执行 | 已安装固定 Agent | 管理员手动运行已验证安装器 |
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

支持两种显式运输计划：管理员预置离线包，或管理员允许的 registry 按 digest 获取。生产与开发环境无需互通；管理员自行传递受审文件。默认不要求生产连接 GitHub、OIDC、签名服务或开发机。

OCI manifest digest、image config digest、Docker image ID 和 tag 是不同身份。Agent 必须验证 descriptor / config / layers 的内容关联与平台，不能把 `.Id` 与 OCI manifest digest 直接比较，也不能因 tag / revision label 相同就信任镜像。

离线包先验证签名 manifest 与 transport hash，再验证镜像内容图，最后导入。Docker 29.1.3 实际能接受的 archive 形式由 M1 / M3 在目标 VM 确定并冻结。导入后若 RepoDigests 不可用，必须通过已验证内容图与实际 config ID / rootfs diff IDs 建立可检查绑定；该适配器未通过真实测试前，离线 import 不能发行。禁止临时安装替代镜像工具或偷偷回到生产 build。

所有长期引用以 digest 为准。可选 tag 仅用于显示。运行容器的实际 image identity、manifest 绑定、应用自身 release identity 都应一致；Web 与 Worker 不得只报告同 semver 作为接受证明。

## Agent 发行包

规范包至少包含：

- `agent-manifest.json`：Agent version、payload hash、每文件 hash、入口、平台、私有 Node / SQLite / verifier 版本、协议范围、store 读写 epoch、最低 installer 版本。
- 内容寻址 payload：Agent / CLI、私有 Node 24 运行时、受限 verifier、公共协议与安全策略；无应用源码、生产配置或凭据。
- 独立安装 / 回退管理器及受审的新建项目服务模板，文件清单标明安装 owner / mode；不提供覆盖既有 V1 unit 的模板。
- SBOM、license、来源 / build provenance、L2 / L3 compatibility summary 与完整环境锁 digest、签名 bundle 和使用说明。

包必须同时可验证来源、完整性、兼容性。SHA-256 只能证明与给定内容一致，不能独立证明发布者身份。

发行使用固定受保护 workflow 的 Sigstore provenance / signature bundle；离线验证必须携带受信根、签名证明和精确身份政策。审核 repo 的稳定 repository ID、OIDC issuer、workflow / ref 身份、source commit、subject digest 与受保护 tag，不仅比较 repository 名称。GitHub 离线文档说明名称可重用，应额外核对 repository ID。[离线 attestation 验证与身份限制](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)

Sigstore bundle 可包含离线验证材料，但实际 verifier 版本和所有离线路径仍须 VM 测试，不能因官网支持就省略发行验证。[Sigstore bundle 与本地验证](https://docs.sigstore.dev/cosign/verifying/verify/)

管理员先独立建立 trust root / verifier 信任；不能先执行未知包内 installer，再让它证明自身可信。首次包需在可信环境核验签名与来源，通过独立受控渠道给出管理员批准的 payload / installer digest，生产再次核对传输内容。后续包由已经受信的 installer / verifier 验证。

信任材料使用独立版本、有效期和撤销快照。离线主机只能知道已导入的撤销信息，不能声称实时撤销检查。过期、未知时间、身份不符或材料不足均停止安装，由管理员补充受审材料；不自动联网刷新、不使用忽略签名 / claim 的 bypass。密钥轮换和信任根替换需另行明确授权。

## 安装布局与激活真相

拟定布局均为设计路径：

| 路径 | 内容 / 权限 |
| --- | --- |
| `/opt/lumina-deployment-agent/releases/<payload-digest>/` | root 所有的只读完整版本；私有 runtime 和 Agent 一起冻结 |
| `/opt/lumina-deployment-agent/current` | 唯一 active pointer，root 所有的受控 symlink，只允许指向上述 release 目录 |
| `/etc/lumina-deployment-agent/` | root 所有的 site 配置、trust policy；由管理员独立管理 |
| `/var/lib/lumina-crm/deployment-v2/` | 项目所有的唯一 state DB、受限 evidence / artifact cache |
| 管理员安装日志目录 | root 所有 0700；安装 intent、旧 / 新 digest、真实 pointer / service 观测、结果 |
| 项目 runtime 目录 | 项目所有的私有 socket；不暴露 TCP API |

安装 receipt 是 pointer 与实际运行版本的导出 / 证据，不能另成一个与 pointer 竞争的 active version。路径和 mode 会在真实 VM 验证后冻结，不能依赖管理员任意 `$PATH` 或可写源码目录。

首次安装只创建审核过的 V2 专属资产，复用已存在的项目身份 / rootless 环境。缺少 prerequisites 就停止并列出条件。不得安装或替换服务器全局 Node、Docker、PostgreSQL、systemd；不得修改其他项目。若管理员当前边界不允许创建新项目服务，保持只读 shadow，不绕过限制。

## 独立升级事务

安装器属于独立的文件激活域，不是第二套应用部署状态机。安装日志不得写 application accepted pointer、标记业务迁移成功或归档应用请求。

1. **Plan / verify**：验证当前 installer 身份、新包全部签名 / hash / 平台 / 协议、space 与 scope；列出旧 / 新版本、文件变更、store 兼容和具体回退资格。
2. **Stage**：在同一受控文件系统的临时目录解包，拒绝 traversal、link escape、设备文件、setuid、未列文件；核实每个文件后 fsync 并原子固定 release 目录。
3. **Quiesce**：暂停新请求，确认无仍在执行的副作用。取得项目 / 安装互斥，记录实际服务与原外部任务状态，制作一致的 store 只读备份用于取证；不得把原始私有状态公开。
4. **Activate intent**：先落盘旧 / 新 pointer 和验证摘要；原子 rename 切换唯一 pointer 并 fsync 父目录。不要分别改多份 active version 文件。
5. **Start / verify**：管理员启动新 V2 专属服务；核对实际执行文件、payload digest、socket peer、store epoch、自检与只读 status。新服务在升级恢复阶段不自动继续业务步骤。
6. **Complete**：落盘实际核验结果；明确允许请求后才恢复业务发布。新版本尚未证明健康，不能标记 COMPLETE。

初版 Agent `1.x` 固定 store epoch=1，只允许向后可读写的新增字段 / 表，禁止破坏性格式迁移。安装器不能隐式迁移业务 schema。需要不兼容 store 格式时必须另立有明确维护窗口和迁移 / 回退方案的版本里程碑。

正常升级要求无未解决应用操作。紧急恢复升级只允许新旧 Agent 都支持同一 store epoch、迁移 receipt 协议与原操作类型，并在管理员批准的 recovery-only 模式启动；只允许观测与 `reconcile`，后续副作用仍需独立恢复计划。不能用升级自动解除未知操作。

## 失败与回退判定

| 故障位置 | 允许动作 | 禁止动作 |
| --- | --- | --- |
| 签名 / hash / schema / 来源失败 | 拒绝，旧服务保持原样 | 执行新 installer hook、忽略签名 |
| Stage 未完成 | 删除经确认属于本次操作的临时目录或保留取证；旧 pointer 不变 | 删除 release 历史、清理卷 |
| pointer intent 后崩溃 | 先读取真实 pointer / 文件 / 服务身份，继续核验或回到明确旧版本 | 仅按日志 stage 猜测当前版本 |
| 新 Agent 启动失败且旧版本兼容当前 store | 用同一安装日志原子恢复旧 pointer，验证旧服务；当前 store 保留 | 用旧备份覆盖后来状态 |
| store epoch / 未解决操作不被旧版本支持 | 保持维护 / recovery-only，向前修复 Agent | 强制降级、删 store、重放迁移 |
| Agent 回退完成 | 应用运行与 acceptedRelease 不变；记录 Agent 回退结果 | 同时回退应用、数据库或系统依赖 |

Agent 回退和应用回退始终是两件事。应用回退沿用 [真实 schema 兼容与恢复协议](03-state-machine-and-recovery.md)，不因 Agent 二进制恢复就重复旧发布。

## 发行门槛

受审来源与 SBOM、包内私有运行时、签名正负例与纯离线验证、目标 Ubuntu VM 的 L2 / L3、相邻受支持 Agent 升降级、状态完整性与崩溃恢复、未改其他项目的证据，缺一不可。测试 Mock / CLI 通过和文档已写完不能满足该门槛。

新 Agent 版本进入生产还需管理员审阅准确包 digest、兼容报告、当前只读诊断、变更计划和回退资格。普通应用 release workflow 永远不能替管理员完成这一步。
