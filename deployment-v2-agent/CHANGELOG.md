# Agent changelog

## 0.2.0-alpha.1

- 从 M1 虚构生命周期试验固化独立 CLI / worker、私有 Node、单一 SQLite 与受限任务协议；不接管 V1 或执行应用发布。
- 增加计划 / Agent / revision 绑定、不可重置 grant、不可变 intent / receipt、显式采证恢复与安全只读状态接口。
- 固定 oneshot / flock 入口；独立诊断采用短 worker thread，保留原预算和未验证的系统门槛。
- 冻结离线目录 v1、固定身份政策和独立 Ed25519 / OCI verifier；生产信任根与 CI attestation 未配置。
- 提供本地隔离 Linux 与外部 CI 测试入口；真实 Linux 子集通过不代表生产 Ubuntu / Rootless / systemd 兼容。
