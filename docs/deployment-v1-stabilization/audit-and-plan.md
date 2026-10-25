# V1 一键部署稳定化审计与修改计划

2026-10-26。审计基线 `ac24bc0`；只修改现有 V1，不继续 V2。未连接生产，不能从仓库推断最近每次生产故障的真实 errno、权限或发生时间；原始生产材料如后续提供，只保留忽略的 work/，公开仅记脱敏结论。

## 已确认的问题与失败分类

| 类别 | 仓库证据 / 判断 | 本次处理 |
| --- | --- | --- |
| 控制平面诊断缺陷 | host-preflight 的隔离检查把身份、环境、deploy.env、socket、三个目录、Docker 命令及 JSON 全部 catch 成 false；原错误与路径类别丢失 | 在同一模块返回固定阶段 / 条件码、受限元数据与依赖关系；保留 fail-closed |
| 环境继承不一致 | Host Preflight 自建 Docker env 缺 HOME / XDG_RUNTIME_DIR / user bus；Runner 继承实际 service 环境；调用端 DOCKER_CONTEXT / config / endpoint 冲突也被压成 false | 固定实际账户的 home / runtime / bus；冲突键明确报错，不回退 rootful、默认 context 或另一 config |
| 权限变化来源 | systemd deploy unit 使用 UMask=0027；维护 prepare 只保证 Docker config 根目录私有，其他目录可能由 Docker / Buildx 创建；preflight 对每个目录统一要求零 group / other 位 | 分开报告目录角色、mode、owner 是否匹配；先验证写入方，不直接 chmod 生产或放宽所有权限 |
| 非必要阻断 | CLI 外层、start、静态 target 校验、Bootstrap、Controller Entry 多次执行完整 preflight；包含 buildx prune / bootstrap、全部维护 unit 和维护 bundle | 保留接管前与 Controller Entry 的检查；按准入 / 发布 / 完整维护区分所需能力，移出普通发布不调用的维护能力 |
| 已修复的错误安全输入 | 现有 Compose 探针已修正 tmpfs 引号与 512m 归一化；其字段门禁仍必要 | 保留真实 Compose 2.40.3 回归和全部容器隔离字段，不再次弱化 |
| 应用构建失败 | Runner 的 verification / application / operations Buildx 阶段有独立阶段与退出；与 host isolation 不能混为一类 | 保留构建 gate；本次不改业务代码 / npm 依赖，不声称已复现未知生产构建失败 |
| 宿主机问题 | 非本账户、错误 socket、Rootful / data-root / cgroup 不符、权限 / 文件缺失 / Docker 连接失败必须阻断 | 精确报第一失败条件；从依赖不可执行区分实际能力失败 |
| 跨版本控制协议 | 当前已有 handoff protocol / audited legacy catalogue / target 静态校验；普通源码更新会读新 target 要求 | 不另建状态或 Agent；明确控制面文件需要独立兼容性审查，保留跨提交接管回归 |

## 检查分层

| 位置 | 必须保留 | 可简化 / 移至维护 |
| --- | --- | --- |
| 请求准入与启动服务前 | Node / 账户 / 固定部署 unit 信任、admission / deployment / maintenance 锁、未完成 host operation、请求与归档一致性 | 不重复整套 Docker 能力 / Builder 检查；目标静态校验仍在持久化请求前执行 |
| 常规发布与 Controller Entry | 真实 Rootless UID / socket / data-root / cgroup、安全 Compose 归一化、实际使用的 Buildx / Compose 能力、Builder owner / image / network / proxy、磁盘容量、部署 unit | 清理用 prune flags、替换 Builder 用 inspect --bootstrap、完整维护 unit / bundle 不作为日常发布前置 |
| 首装 / 维护 / host-check | 完整工具能力、维护程序信任和安装回执、全部 unit、替换批准 / cache-loss、目录 provisioning | 不自动安装依赖、不替换 Docker / Builder、不隐式升级控制面 |
| 接受 / 回滚 / 恢复 | 原请求、执行锁、迁移账本、镜像 / schema 兼容、public edge 接受、finalization 和显式 reconcile | 不重置状态、不自动重放未知迁移；不因本次简化引入另一恢复协议 |

## 最小实施与验收

1. 先提交本审计，再修改现有 host-preflight / capability 模块；增加隔离错误首因、环境与权限回归。只保存固定 role / errno / mode / boolean，不打印原 env、原 stderr、任意路径或 daemon 全量 info。
2. 明确并测试准入 / 发布 / 完整维护边界；移除证实重复或只服务维护的阻断，保留执行前安全门禁与锁。所有持久化状态 / receipt / handoff 字段不变。
3. 对目录模式只做与实际工具行为及安全边界一致的窄修复；没有证据的生产权限异常继续阻断，并提示管理员只读取证。部署流程不自动 chown / chmod。
4. 运行针对性 V1 tests、现有恢复 / finalization / 跨提交回归、类型、Lint、隐私与真实 Compose；复用外部 Ubuntu CI，核对实际 Docker / Compose 包版本与文件系统行为。Mock 与真实 Linux 分开报告，生产发布 NOT_RUN。
5. 保存最终变更与验证结果并独立提交；如需推送新验证分支，先形成候选再取得授权。不运行生产命令、不修改 HunterAI、不引入新服务 / DB / 分发设施。

本次验收是 V1 路径更少重复门禁且失败可解释；不是远程生产发布成功证明。未知生产故障仍需管理员提供受限只读证据，不能靠猜测归因。
