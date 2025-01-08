# CPU 热插拔

## 参考

- [CPU hotplug in the Kernel — The Linux Kernel documentation](https://docs.kernel.org/core-api/cpu_hotplug.html)
- [【原创】Linux cpu hotplug - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11397084.html)
- [Linux CPU core 的电源管理(5)\_cpu control 及 cpu hotplug](https://www.wowotech.net/pm_subsystem/cpu_hotplug.html)
- [Linux 内核 | CPU 热插拔（Hotplug） - 一丁点儿的网络日志](https://www.dingmos.com/index.php/archives/117/)
- [notes/kernel/cpu_hotplug.md · freelancer-leon/notes](https://github.com/freelancer-leon/notes/blob/master/kernel/cpu_hotplug.md)
- [Linux Kernel cpu 拓扑简介](https://daybreakgx.github.io/2016/10/08/kernel_cpumask/)
- [linux cpu 管理（四） cpu 热插拔 - 知乎](https://zhuanlan.zhihu.com/p/538782115)
- [The usage of cpu hot(un)plug in QEMU - L](https://liujunming.top/2022/01/07/The-usage-of-cpu-hot-un-plug-in-QEMU/)

## 概览

## 使用方法

Linux 内核会创建虚拟总线 `cpu_subsys`，每个 CPU 注册的时候，都会挂载在该总线上，CPU 的 online 和 offline 的操作，最终会回调到该总线上的函数。

```bash
echo 0 > /sys/devices/system/cpu/cpu1/online
echo 1 > /sys/devices/system/cpu/cpu1/online


/path/to/qemu/scripts/qmp/qmp-shell -q unix:/tmp/qmp-sock-0
# 查询可以热插的 cpu
(QEMU) query-hotpluggable-cpus
# 查询现在的 cpu
(QEMU) query-cpus-fast
# 热插 cpu 上去
(QEMU) device_add driver=host-x86_64-cpu socket-id=1 core-id=0 thread-id=0 id=cpu2

```

### 内核命令行参数

- `maxcpus=n` 限制启动时的 CPU 为 `n` 个。例如，如果你有四个 CPU，使用 `maxcpus=2` 将只能启动两个。你可以选择稍后让其他 CPU 上线。
- `nr_cpus=n` 限制内核将支持的 CPU 总量。如果这里提供的数量低于实际可用的 CPU 数量，那么其他 CPU 以后就不能上线了。
- `possible_cpus=n` 这个选项设置 `cpu_possible_mask` 中的 `possible_cpus` 位。这个选项只限于 X86 和 S390 架构。
- `cpu0_hotplug` 允许关闭 CPU0。这个选项只限于 X86 架构。

## 实现原理

### 数据结构

struct cpuhp_cpu_state：用来存储 hotplug 的状态；
enum cpuhp_state：枚举各种状态，这个会对应到全局数组中的某一项，而该项中会定义回调函数。当然，也可以通过函数接口来设置回调函数。
struct cpuhp_step：Hotplug state machine step，主要定义了函数指针，当跳转到某一个状态时会回调。

### 代码分析
