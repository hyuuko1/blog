# CPU 热插拔

## 参考

- 🌟[CPU hotplug in the Kernel — The Linux Kernel documentation](https://docs.kernel.org/core-api/cpu_hotplug.html)
- 🌟[Linux CPU core 的电源管理(5)\_cpu control 及 cpu hotplug](https://www.wowotech.net/pm_subsystem/cpu_hotplug.html)
- [【原创】Linux cpu hotplug - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11397084.html)
- [Linux 内核 | CPU 热插拔（Hotplug） - 一丁点儿的网络日志](https://www.dingmos.com/index.php/archives/117/)
- [notes/kernel/cpu_hotplug.md · freelancer-leon/notes](https://github.com/freelancer-leon/notes/blob/master/kernel/cpu_hotplug.md)
- [Linux Kernel cpu 拓扑简介](https://daybreakgx.github.io/2016/10/08/kernel_cpumask/)
- [linux cpu 管理（四） cpu 热插拔 - 知乎](https://zhuanlan.zhihu.com/p/538782115)
- [The usage of cpu hot(un)plug in QEMU - L](https://liujunming.top/2022/01/07/The-usage-of-cpu-hot-un-plug-in-QEMU/)

## 使用方法

Linux 内核会创建虚拟总线 `cpu_subsys`，每个 CPU 注册的时候，都会挂载在该总线上，CPU 的 online 和 offline 的操作，最终会回调到该总线上的函数。

```bash
# offline
echo 0 > /sys/devices/system/cpu/cpu1/online
# online
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

### CPU hotplug 状态机

```cpp
enum cpuhp_state {
	CPUHP_INVALID = -1,

	/* PREPARE section invoked on a control CPU */
	CPUHP_OFFLINE = 0,
	...
	CPUHP_BP_PREPARE_DYN,
	CPUHP_BP_PREPARE_DYN_END		= CPUHP_BP_PREPARE_DYN + 20,
	CPUHP_BP_KICK_AP,
	CPUHP_BRINGUP_CPU,

	/*
	 * STARTING section invoked on the hotplugged CPU in low level
	 * bringup and teardown code.
	 */
	CPUHP_AP_IDLE_DEAD,
	CPUHP_AP_OFFLINE,
	...
	CPUHP_AP_ONLINE,
	CPUHP_TEARDOWN_CPU,

	/* Online section invoked on the hotplugged CPU from the hotplug thread */
	CPUHP_AP_ONLINE_IDLE,
	...
	CPUHP_AP_ONLINE_DYN,
	CPUHP_AP_ONLINE_DYN_END		= CPUHP_AP_ONLINE_DYN + 40,
	...
	CPUHP_ONLINE,
}

/* 每个 cpuhp_state 有相应的 cpuhp_step */
struct cpuhp_step {
	const char		*name;
	/* cpu online 时，进入某个 state 时，会调用相应的 startup 回调 */
	union {
		int		(*single)(unsigned int cpu);
		int		(*multi)(unsigned int cpu,
					 struct hlist_node *node);
	} startup;
	/* cpu offline 时，离开某个 state 时，会调用相应的 teardown 回调 */
	union {
		int		(*single)(unsigned int cpu);
		int		(*multi)(unsigned int cpu,
					 struct hlist_node *node);
	} teardown;
	/* private: */
	struct hlist_head	list;
	/* public: */
	bool			cant_stop;
	bool			multi_instance;
};

/* 大小 CPUHP_ONLINE 的数组 */
static struct cpuhp_step cpuhp_hp_states[] = {
	...
}
```

- control CPU: 发起并控制 online/offline 流程的 CPU。也被称为 BP
- AP: 被 online/offline 的 CPU

状态空间分为 3 部分：

1. PREPARE

   在 online 时，在 AP 启动之前，BP 需执行 startup 回调，做一些准备操作。例如：为 AP 创建 per-CPU hotplug 线程、初始化 per-CPU RCU data

2. STARTING

   AP 启动后，在关中断的状态下，会执行 startup 回调，

3. ONLINE

   AP 在 hotplug 线程的上下文中执行 startup 回调。

### state 的静态分配与动态分配

- `cpuhp_hp_states[]` 数组中的都是静态注册的，
- CPUHP_BP_PREPARE_DYN，动态的，彼此没有顺序要求
- CPUHP_AP_ONLINE_DYN，动态的，彼此没有顺序要求

### Multi-Instance state

## 代码分析

#### cpu online

在系统 boot 阶段，non-boot cpu 的启动，和 cpu hotplug online 是一样的流程，最后都是调用 `cpu_up()`

```cpp
/* 1 号进程的入口函数 kernel_init */
kernel_init()->kernel_init_freeable()->smp_init()->bringup_nonboot_cpus()
  /* TODO cpuhp_bringup_cpus_parallel() */
  cpuhp_bringup_mask(cpu_present_mask)
    for_each_cpu(cpu, mask) cpu_up(cpu, CPUHP_ONLINE)
```

```cpp
/* echo 1 > /sys/devices/system/cpu/cpu1/online
   cpu 被抽象为一个设备，挂在 cpu bus 上，
   这里会调用总线上的 online 钩子 */
online_store()->device_online()->cpu_subsys_online()
  from_nid = cpu_to_node(cpuid);
  /* 如果失败会多次 retry */
  cpu_device_up(dev)->cpu_up(dev->id, CPUHP_ONLINE)
  /* 当将内存热插拔到内存很少的 node 上然后启用 node 上的 cpu 时，
     cpu 的 node 号可能会变化 */
  to_nid = cpu_to_node(cpuid);
  if (from_nid != to_nid) change_cpu_under_node(cpu, from_nid, to_nid);
```

`cpu_up` 流程简述

1. BP 执行完 CPUHP_OFFLINE 到 CPUHP_BRINGUP_CPU 的 startup 钩子
   1. CPUHP_BP_KICK_AP 钩子，会启动目标 CPU
   2. CPUHP_BRINGUP_CPU 钩子，会
2. AP 被唤醒，
3. AP 执行 cpu hotplug 线程。

```cpp
cpu_up(dev->id, CPUHP_ONLINE)
  /* 先 online cpu 所属的 node，主要是内存管理子系统相关的 */
  try_online_node()
  _cpu_up()
    cpuhp_set_state(cpu, st, target=CPUHP_ONLINE);
      st->rollback = false;
      st->target = target;
      st->single = false;
    /* 从当前的 st->state 到 CPUHP_BRINGUP_CPU 的 startup 回调全部调用一遍 */
    cpuhp_up_callbacks(target=CPUHP_BRINGUP_CPU)->cpuhp_invoke_callback_range()->__cpuhp_invoke_callback_range()
      while (cpuhp_next_state()) cpuhp_invoke_callback()
        step->startup.single()
```

接下来介绍几个 startup 回调

在系统启动阶段，某些子系统会 `smpboot_register_percpu_thread()` 注册与 hotplug 相关的线程，并为 **已经 online 的 cpu** 创建这些 per-cpu 线程。

1. `cpuhp_state.thread` 也就是 hotplug 线程
2. `cpu_stopper.thread`
3. `irq_workd`
4. `backlog_napi`
5. `rcu_data.rcu_cpu_kthread_task`
6. `ksoftirqd`
7. `ktimerd`（如果启用了 `CONFIG_IRQ_FORCED_THREADING` 强制中断线程化）

```cpp
/* CPUHP_CREATE_THREADS startup 回调，为 AP 创建以上 per-cpu 线程 */
smpboot_create_threads()

/* CPUHP_PERF_PREPARE startup 回调 */

/* CPUHP_RANDOM_PREPARE startup 回调 */

/* CPUHP_WORKQUEUE_PREP startup 回调 */

/* CPUHP_HRTIMERS_PREPARE startup 回调 */

/* CPUHP_SMPCFD_PREPARE startup 回调 */

/* CPUHP_RELAY_PREPARE startup 回调 */

/* CPUHP_RCUTREE_PREP startup 回调 */

/* CPUHP_TIMERS_PREPARE startup 回调 */

/* CPUHP_BP_KICK_AP startup 回调：唤醒 AP */
cpuhp_kick_ap_alive()->arch_cpuhp_kick_ap_alive()->native_kick_ap()->do_boot_cpu

/* CPUHP_BRINGUP_CPU startup 回调：唤醒 AP 的 hotplug 线程，让 AP 执行剩余的 startup 回调 */
cpuhp_bringup_ap()
  cpuhp_kick_ap()

/* CPUHP_AP_SCHED_STARTING startup 回调 */
sched_cpu_starting()

/* CPUHP_AP_HRTIMERS_DYING startup 回调：唤醒其他的注册过的与 hotplug 有关的 per-cpu 线程 */
hrtimers_cpu_starting()

/* CPUHP_AP_SMPBOOT_THREADS startup 回调 */
smpboot_unpark_threads()

...
```

AP 的启动

```cpp
start_secondary()
```

AP 的 hotplug 线程。

```cpp
smpboot_thread_fn()
  while (1)
    if (!thread_should_run():cpuhp_should_run())
      schedule();
    else
      thread_fn():cpuhp_thread_fun()
        st->should_run = cpuhp_next_state()
        /* 调用回调 */
        cpuhp_invoke_callback()
        if (!st->should_run)
          complete_ap_thread(st, bringup);
```

#### cpu offline

```cpp
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

## 其他

- [Per-cpu 内存分配](../mm/percpu.md)
