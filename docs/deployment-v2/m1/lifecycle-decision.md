# M1 按需生命周期与 SQLite 决策

2026-10-25，设计基线 `0e786b1`；代码为 [独立 M1 实验](../../../deployment-v2-m1/README.md)，不是可安装 Agent。M1 保持 oneshot 为 M2 首选，但尚未获得真实 systemd / Rootless / 重启证据，不能判定生产生命周期已经可用。也没有证明新增常驻服务是必要的。

## 已实现的最小协议

CLI `submit` 在 SQLite `BEGIN IMMEDIATE` 内校验请求 key / 内容摘要、拒绝不同内容复用 key、限制一个未解决操作，并与事件同事务提交。`QUEUED/READY → RUNNING/CLAIMED` 使用 revision CAS，只领取一次；grant 不包含可由 shell 解释的内容。

worker 仅做可控延迟与排他创建一份 `FICTIONAL_EFFECT` receipt。确认真实文件、operation ID 和 task digest 后，`COMPLETED/DONE` 与事件同事务写入。已领取但未确认的任务重复运行返回无工作，不会重放。恢复以真实文件为依据；无文件保留 `RECOVERY_REQUIRED/CLAIMED`，不推断 NO_EFFECT，不重置授权。活跃或无权探测的旧 worker PID 阻止 reconcile；PID 重用可能保守阻断，M2 要以 manager invocation / 执行身份取代单独 PID。

SQLite 使用 Node 内置 API、禁扩展、1500 ms busy timeout、DELETE journal 和 synchronous EXTRA；无数据库服务、无业务 PostgreSQL 表。Linux 文件 / receipt 做文件及父目录 fsync。上述设置是实现选择，不能单凭设置证明断电持久性。[Node SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

Linux CLI 写入经 `/usr/bin/flock --exclusive --nonblock --no-fork`，worker 按 `/proc/locks` 核对 PID / device / inode，不能因环境不支持就切换为 Mock。Windows 测试只证明原生 SQLite 事务 / 多进程行为，明确没有 Linux 内核锁认证。

## 原型与正式 unit 的边界

只有非 root、显式批准的非生产实验允许 systemd-run 创建名称带随机实验 ID 的 transient user unit。候选属性为 Type=oneshot、RemainAfterExit=no、Restart=no、KillMode=control-group、TimeoutStartSec=12s、MemoryMax=128M、TasksMax=64；均未在当前机器实测。派发只返回 ENQUEUED，不返回完成；status 仅查询 SQLite，不自动启动或恢复任务。

这用于验证 user manager 接管，M2 仍需冻结一个固定、受审、受限参数的正式 unit / 启动器。正式设计不允许客户端任意 transient unit、shell 或环境参数。systemd-run 的服务由 manager 管理，oneshot 时限必须显式设置；这些上游语义不能替代本项目实测。[systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)、[systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

## 实际证据与缺口

| 能力 | 本次结果 / 方法 | 尚未证明 |
| --- | --- | --- |
| SQLite 原子准入、grant / CAS | PASS，Windows 原生 SQLite；真实冲突、旧 revision 拒绝、重复任务零新增效果 | Linux 文件系统 / 锁、异常磁盘、断电 |
| 并发请求串行化 | PASS，4 个实际 CLI 进程竞争，仅一个准入 | systemd 重复启动、installer 竞争、V1 fence |
| 普通进程退出与恢复识别 | PASS，实际退出 23 / 24、实际 kill worker、活跃 worker 拒绝核对、receipt 决定结果 | unit timeout / cgroup 子进程清理、user manager 消失 |
| Linux flock / 文件持久化 | NOT_RUN，Windows；测试不会模拟该能力 | 真实内核锁、文件 / 目录 fsync、挂载与权限负例 |
| CLI 退出后 oneshot 继续 | NOT_RUN，有 opt-in systemd 测试，但没有执行环境 | 实际 unit invocation、完成后零闲置进程 |
| 真实终端断线 / SIGHUP | NOT_RUN；普通子进程退出不等于断开会话 | 无终端保活依赖、关闭登录会话后的行为 |
| 重启、断电、ENOSPC / EIO | NOT_RUN，无可丢弃外部测试目标 | 旧 intent 找回、journal 处理、只读取证不自动恢复 |

## M2 输入与停止条件

允许继续离线实现固定启动器、包结构、SQLite store / grant 的 alpha；保留一个 mutable 事务事实来源，不从原型的虚构 receipt 推导业务效果。M2 必须明确 unit dispatcher、短 worker、installer 的同锁顺序、服务执行身份、未解决操作与 owner epoch；不能依赖 supervisor 常驻持锁来 fence V1。

获得合适非生产 Linux 后，先在相同候选摘要上补 CLI 退出 / 真实断线、exit / timeout / 子进程回收、重复派发、manager restart 与限额证据，再在可丢弃目标做 OS reboot / power loss。没有相应环境，逐项 NOT_RUN 并阻断生产写入版，不能转移到生产执行或自动增设 daemon。

M1 代码里没有应用迁移、容器激活、版本接受、V1 导入、安装回退或生产恢复入口；这些语义按既有 [状态机设计](../03-state-machine-and-recovery.md) 在后续里程碑实现。
