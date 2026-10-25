# M2 Offline Alpha 实施范围

基线：M0 `0e786b1`、M1 `e93cc03`，CRM `3.44.0`。沿用既有按需 Agent / 单一 SQLite / 证据恢复设计，正式发行和生产写入仍禁止。

1. 在独立 `deployment-v2-agent/` 包实现固定 CLI / worker；只接受虚构 checkpoint 任务。生成自包含 JavaScript 与固定 Node 24.22.1 私有运行时，不从请求接收 shell、unit 属性或升级指令。
2. 固定 epoch=1 Alpha store：site revision、operation CAS、一次性 action grant、不可变 intent / receipt / evidence 与同事务事件。事务提交与外部文件效果分开；领取后未知结果只能显式 reconcile，不能按超时重新执行。
3. Linux 统一锁顺序为内核 flock → SQLite 短事务；固定名称 user oneshot、固定 ExecStart 与限额，派发只启动预先受审 unit，不安装服务。Windows 明示 SQLite-only；真实 Linux / systemd 能力分别取证。
4. 冻结离线目录运输 v1：签名 manifest、固定身份政策、文件 / OCI 内容摘要、独立 verifier。测试密钥只允许显式非生产测试模式；不引入 Registry、构建服务器、真实镜像加载或应用升级。
5. 保留 M1 独立主机诊断包与全部测试；新增独立的状态只读诊断接口，拒绝 journal / 不兼容库的自动恢复。采用短 worker thread 减少额外 Node 进程基线，保留 128 MiB / 45 秒预算和隐私白名单。
6. 提供外部 Linux CI 入口，优先取得现有环境的真实 flock / 文件系统 / Compose 证据。Docker Desktop 容器只能认证其实际 Linux 子集，不认证 Ubuntu 目标包线、Rootless 或 systemd；相应未测能力记 NOT_RUN。
7. 保存协议、验收、能力清单、资源差异与 M3 Go / No-Go；完成针对性测试、类型、Lint、隐私与文档检查后独立提交，不推送或部署。

开发测试只用新建、带 Alpha scope marker 的隔离目录和虚构任务。没有 V1 适配器、业务 PostgreSQL、应用迁移、容器切换或生产访问。正式 installer / Sigstore 发行 / 数据迁移 / V1 fence 验证仍按原里程碑，不以 Alpha 的本地签名或成功任务替代。
