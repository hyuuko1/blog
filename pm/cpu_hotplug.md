# CPU 热插拔

## 参考

- 🌟[Linux CPU core 的电源管理(5)\_cpu control 及 cpu hotplug](https://www.wowotech.net/pm_subsystem/cpu_hotplug.html)
- [CPU hotplug in the Kernel — The Linux Kernel documentation](https://docs.kernel.org/core-api/cpu_hotplug.html)
- [【原创】Linux cpu hotplug - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11397084.html)
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

# 用 QEMU 验证热插拔功能
/path/to/qemu/scripts/qmp/qmp-shell -p /path/to/qmp-sock
# 查询可以热插的 cpu
(QEMU) query-hotpluggable-cpus
# 查询现在的 cpu
(QEMU) query-cpus-fast
# 热插 cpu 上去
(QEMU) device_add driver=host-x86_64-cpu core-id=2 node-id=0 socket-id=0 thread-id=0
```

### 内核命令行参数

- `maxcpus=n` 限制启动时的 CPU 为 `n` 个。例如，如果你有四个 CPU，使用 `maxcpus=2` 将只能启动两个。你可以选择稍后让其他 CPU 上线。
- `nr_cpus=n` 限制内核将支持的 CPU 总量。如果这里提供的数量低于实际可用的 CPU 数量，那么其他 CPU 以后就不能上线了。
- `possible_cpus=n` 这个选项设置 `cpu_possible_mask` 中的 `possible_cpus` 位。这个选项只限于 X86 和 S390 架构。
- `cpu0_hotplug` 允许关闭 CPU0。这个选项只限于 X86 架构。

## 实现原理

对于支持 CPU hotplug 功能的平台来说，可以在系统启动后的任意时刻，关闭任意一个 secondary CPU（对 ARM 平台来说，CPU0 或者说 boot CPU，是不可以被关闭的），并在需要的时候，再次打开它。因此，相应的 CPU 控制流程如下：

1. boot CPU 启动，其 up/down 的控制流程和生命周期，和单核 CPU 一样。
2. boot CPU 启动的过程中，调用 cpu_up 接口，启动 secondary CPU，使它们变成 online 状态，这是 secondary CPUs 的 up 过程的一种。
3. 在系统负荷较低、或者不需要使用的时候，调用 cpu_down 接口，关闭不需要使用的 secondary CPU，这是 secondary CPUs 的 down 过程。
4. 在需要的时候，再次调用 cpu_up 接口，启动处于 down 状态的 CPU，这是 secondary CPUs 的 up 过程的另一种。

系统启动的时候，可以通过命令行参数“maxcpus”，告知 kernel 本次启动所使用的 CPU 个数，该个数可以小于等于 possible CPU 的个数。系统初始化时，只会把“maxcpus”所指定个数的 CPU 置为 present 状态

### 数据结构

struct cpuhp_cpu_state：用来存储 hotplug 的状态；
enum cpuhp_state：枚举各种状态，这个会对应到全局数组中的某一项，而该项中会定义回调函数。当然，也可以通过函数接口来设置回调函数。
struct cpuhp_step：Hotplug state machine step，主要定义了函数指针，当跳转到某一个状态时会回调。

### 代码分析

```cpp
/* echo 1 > /sys/devices/system/cpu/cpu1/online
   cpu 被抽象为一个设备，挂在 cpu bus 上，
   这里会调用总线上的 online 钩子 */
online_store()->device_online()->cpu_subsys_online()
  from_nid = cpu_to_node(cpuid);
  /* 如果失败会多次 retry */
  cpu_device_up(dev)->cpu_up(dev->id, CPUHP_ONLINE)
    _cpu_up()
      /* 传入的 target 是 CPUHP_BRINGUP_CPU */
      cpuhp_up_callbacks()->cpuhp_invoke_callback_range()->__cpuhp_invoke_callback_range()
        /* 从当前的 st->state 到 CPUHP_BRINGUP_CPU 的回调全部调用一遍 */
        while (cpuhp_next_state()) cpuhp_invoke_callback()
          /* cpuhp_kick_ap_alive */
          step->startup.single()
  /* 当将内存热插拔到内存很少的 node 上然后启用 node 上的 cpu 时，
     cpu 的 node 号可能会变化 */
  to_nid = cpu_to_node(cpuid);
  if (from_nid != to_nid) change_cpu_under_node(cpu, from_nid, to_nid);


cpuhp_kick_ap_alive()->arch_cpuhp_kick_ap_alive()->native_kick_ap()->do_boot_cpu


/* echo 0 > /sys/devices/system/cpu/cpu1/online */
online_store()->device_offline()->cpu_subsys_offline()
  cpu_device_down()->cpu_down(dev->id, CPUHP_OFFLINE)
    cpu_down_maps_locked()


/* hotplug 的回调 */
cpuhp_setup_state
cpuhp_setup_state_multi
cpuhp_setup_state_nocalls


static struct cpuhp_step cpuhp_hp_states[] = {
	[CPUHP_BP_KICK_AP] = {
		.name			= "cpu:kick_ap",
		.startup.single		= cpuhp_kick_ap_alive,
	},
	[CPUHP_BRINGUP_CPU] = {
		.name			= "cpu:bringup",
		.startup.single		= cpuhp_bringup_ap,
		.teardown.single	= finish_cpu,
		.cant_stop		= true,
	},
}

struct smp_ops smp_ops = {
	.kick_ap_alive		= native_kick_ap,
}
```

##

CONFIG_HOTPLUG_PARALLEL
