# M2.2 Rootless 准备过程审计

本报告只分析外部托管 VM，未接触生产。M2.1 既有报告、摘要、测试和失败历史保持原样。

## 已确认的缺失链路

1. M2.1 所用 Ubuntu 24.04 Runner image `20261012.334.1` 的 Docker toolset 只列 containerd.io、docker-ce-cli、docker-ce；安装脚本使用 no-install-recommends。extras 属于 Recommends，初始缺少 launcher / RootlessKit 并不表明 Engine 损坏。
2. M2.2 在同一 24.04 image 上记录：初始 extras / 两个程序均不存在、固定 Docker source 文件未配置。旧流程的 apt update 和 helper 安装计划均成功，但精确匹配已装 `5:28.0.4-1~ubuntu.24.04~noble` 的 extras 计划退出 100，分类为 EXTRAS_VERSION_ABSENT。Ubuntu 26.04 的已装 CE 版本也出现同类失败。
3. Engine 已装不等于对应 APT source / 历史版本可用。原流程把这两个条件耦合，又只打印通用准备失败，丢掉了首因。官方包索引中 Engine / extras 的 28.0.4 epoch 都是 `5:`，没有 epoch 不一致证据。

M2.1 的原始 apt 日志没有公开保存，不能反推其每一行错误；以上将镜像定义、当前受控复现和历史不可观测范围分别列明，不伪造历史现场证据。M2.2 的旧 extras 操作是安装计划模拟，不计为真实 Rootless 测试。

## 外部 fixture 的修复

- 24.04：优先从已启用的签名 APT 源取匹配 extras；版本不可用时，只允许已审的官方 28.0.4 DEB，SHA-256 `2abb177d60561ac77b50a42b60500ab194b70f40f4b225d837c1fdccaaab7a28`。提取到临时目录，不安装或升级 Engine。
- 26.04：取 Ubuntu docker.io / Compose / Buildx，并配套提取 Ubuntu containerd / runc。保留完整 package revision / hash，不把 CE 同名版本当作 Ubuntu 包。修正 `+ds1` 源码重打包 revision 选择；拒绝前缀相似版本及 rc。
- launcher 通过 PATH 查找 docker-rootlesskit / rootlesskit，不识别候选最初使用的覆盖变量。固定目录只映射必要 Engine 二进制，RootlessKit 使用系统 Ubuntu 包的规范路径及既有 AppArmor 策略；不关闭策略或更改 userns sysctl。
- 无登录会话的 user manager 不会继承调用 CLI 的环境。第三轮在两个 OS 上均直接观测到 RUNTIME_DIRECTORY_UNAVAILABLE。仅在测试专属 unit 固定该 UID 的 HOME、XDG_RUNTIME_DIR、DBUS_SESSION_BUS_ADDRESS；不修改目录权限或系统 user@ 模板。
- 新 UID 不能读取系统 journal 时，不将其加入 adm / journal 组。只将本次 unit 输出写入自己的私有文件，有界读取 32 KiB 尾部，正向提取原因码；原文不上传。

## manager degraded 的边界

在定义任何测试 unit 前采集 baseline failed 集合。已观测 24.04 有一个 GPG 类失败，26.04 有两个 baseline 失败；这些不由 Alpha 任务造成。只读查询 manager 接口成功，再用本次固定 false oneshot 制造一个已知失败，记录 degraded，并只 reset 这个已知 unit。

最终清理仅处理本次三个固定 unit，核对 baseline 集合严格不变，剩余本次失败数为 0；不使用无参数 reset-failed，不重启 manager 来掩盖检查结果。新账户的 manager / linger 在 fixture 结束时停止 / 取消，VM 由平台销毁。

socket unit 未必有 ExecMainStatus；初期 M2.2 reporter 曾以默认 0 表示缺失值，已补回归改为省略未观测退出码。历史 artifact 不重写，最终报告采用修正后候选。GPG / OTHER 是公开分类，实际任意 unit 名不导出。

## 来源与证明限制

[Runner 固定 toolset](https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/toolsets/toolset-2404.json)、[安装脚本](https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/scripts/build/install-docker.sh)、[官方 Docker 包索引](https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/)、[28.0.4 launcher](https://github.com/moby/moby/blob/v28.0.4/contrib/dockerd-rootless.sh)。实际 run / SHA / resource 及未测项统一见 M2.2 验收；文档或包下载本身不证明 daemon、内核限额或生产兼容性。
