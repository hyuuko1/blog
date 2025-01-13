# Linux CPU core 的电源管理

## 参考

- [Linux CPU core 的电源管理(1)\_概述](https://www.wowotech.net/pm_subsystem/cpu_core_pm_overview.html)

## 概览

CPU core 相关的电源管理，主要完成如下功能：

1. 系统启动时，CPU core 的初始化、信息获取等。
2. 系统启动时，CPU core 的启动（enable）。
3. 系统运行过程中，根据当前负荷，动态的 enable/disable 某些 CPU core，以便在性能和功耗之间平衡。
4. CPU core 的 hotplug 支持。所谓的 hotplug，是指可以在系统运行的过程中，动态的增加或者减少 CPU core（可以是物理上，也可以是逻辑上）。
5. 系统运行过程中的 CPU idle 管理（具体可参考“Linux cpuidle framework 系列文章”）。
6. 系统运行过程中，根据当前负荷，动态的调整 CPU core 的电压和频率，以便在性能和功耗之间平衡。

## 软件架构

### 平台无关

kernel/cpu.c

CPU control 模块，屏蔽底层平台相关的实现细节，提供控制 CPU（enable、disable 等）的统一 API，供系统启动、进程调度等模块调用；

- CPU subsystem driver，向用户空间提供 CPU hotplug 有关的功能；
- cpuidle，处理 CPU idle 有关的逻辑，具体可参考“cpuidle framework”相关的文章；
- cpufreq，处理 CPU frequency 调整有关的逻辑，具体可参考后续的文章；

### 平台相关

arch/x86/kernel/

- CPU 信息的获取（cpuinfo）；
- CPU 拓扑结构的获取（cpu topology）；
- 底层的 CPU 操作（init、disable 等）的实现，cpu ops（在 ARM32 中是以 smp ops 的形式存在的）；
- SMP 相关的初始化（smp）；

## kernel cpu control

kernel/cpu.c

是一个承上启下的模块，负责屏蔽 arch-dependent 的实现细节，向上层软件提供 CPU core 控制的统一 API。主要功能包括：

1. 将 CPU core 抽象为 possible、present、online 和 active 四种状态，并以 bitmap 的形式，在模块内部维护所有 CPU core 的状态，同时以 cpumask 的形式向其它模块提供状态查询、状态修改的 API。
2. 提供 CPU core 的 up/down 操作，以及 up/down 时的 notifier 机制
3. 提供 SMP PM 有关的操作

### CPU core 的 4 种状态（现在有 6 种）

这里一共有 4 种状态需要表示：

- `cpu_possible_mask`，系统中包含的所有的可能的 CPU core，在系统初始化的时候就已经确定。对于 ARM64 来说，DTS 中所有格式正确的 CPU core，都属于 possible 的 core；
- `cpu_present_mask`，系统中所有可用的 CPU core（具备 online 的条件，具体由底层代码决定），并不是所有 possible 的 core 都是 present 的。对于支持 CPU hotplug 的形态，present core 可以动态改变；
- `cpu_online_mask`，系统中所有运行状态的 CPU core（后面会详细说明这个状态的意义）；
- `cpu_active_mask`，有 active 的进程正在运行的 CPU core。

- possible 状态的 CPU 意味着是“populatable（觉得这个单词还没有 possible 易懂）”的，可理解为存在这个 CPU 资源，但还没有纳入 Kernel 的管理范围；
- present 状态的 CPU，是已经“populated”的 CPU，可理解为已经被 kernel 接管；
- online 状态的 CPU，表示可以被调度器使用；
- active 状态的 CPU，表示可以被 migrate（什么意思？）；

如果系统没有使能 CPU Hotplug 功能，则 present 等于 possible，active 等于 online。

```cpp
/* include/linux/cpumask.h */

/* 暴露给其他模块的是常量指针，不希望被修改 */
#define cpu_possible_mask ((const struct cpumask *)&__cpu_possible_mask)
#define cpu_online_mask   ((const struct cpumask *)&__cpu_online_mask)
#define cpu_enabled_mask   ((const struct cpumask *)&__cpu_enabled_mask)
#define cpu_present_mask  ((const struct cpumask *)&__cpu_present_mask)
#define cpu_active_mask   ((const struct cpumask *)&__cpu_active_mask)
#define cpu_dying_mask    ((const struct cpumask *)&__cpu_dying_mask)

#define for_each_possible_cpu(cpu) for_each_cpu((cpu), cpu_possible_mask)
#define for_each_online_cpu(cpu)   for_each_cpu((cpu), cpu_online_mask)
#define for_each_enabled_cpu(cpu)   for_each_cpu((cpu), cpu_enabled_mask)
#define for_each_present_cpu(cpu)  for_each_cpu((cpu), cpu_present_mask)

void init_cpu_present(const struct cpumask *src);
void init_cpu_possible(const struct cpumask *src);
void init_cpu_online(const struct cpumask *src);

#define set_cpu_possible(cpu, possible)	assign_cpu((cpu), &__cpu_possible_mask, (possible))
#define set_cpu_enabled(cpu, enabled)	assign_cpu((cpu), &__cpu_enabled_mask, (enabled))
#define set_cpu_present(cpu, present)	assign_cpu((cpu), &__cpu_present_mask, (present))
#define set_cpu_active(cpu, active)	assign_cpu((cpu), &__cpu_active_mask, (active))
#define set_cpu_dying(cpu, dying)	assign_cpu((cpu), &__cpu_dying_mask, (dying))

static __always_inline unsigned int num_online_cpus(void)
{
	return raw_atomic_read(&__num_online_cpus);
}
#define num_possible_cpus()	cpumask_weight(cpu_possible_mask)
#define num_enabled_cpus()	cpumask_weight(cpu_enabled_mask)
#define num_present_cpus()	cpumask_weight(cpu_present_mask)
#define num_active_cpus()	cpumask_weight(cpu_active_mask)

static __always_inline bool cpu_online(unsigned int cpu) {}
static __always_inline bool cpu_enabled(unsigned int cpu) {}
static __always_inline bool cpu_possible(unsigned int cpu) {}
static __always_inline bool cpu_present(unsigned int cpu) {}
static __always_inline bool cpu_active(unsigned int cpu) {}
static __always_inline bool cpu_dying(unsigned int cpu) {}
```

```cpp
topology_init_possible_cpus()
  init_cpu_present(cpumask_of(0));
  init_cpu_possible(cpumask_of(0));
  for (cpu = 0; cpu < allowed; cpu++)
    set_cpu_possible(cpu, true);
    set_cpu_present(cpu, test_bit(apicid, phys_cpu_present_map));
```

### up/down

```cpp
/* include/linux/cpu.h */
int cpu_device_up(struct device *dev);
/* include/linux/cpuhplock.h */
int cpu_device_down(struct device *dev);
```

### SMP PM 有关的操作

系统 suspend 过程中，将 noboot 的 CPU 禁用，并在系统恢复时恢复

```cpp
/* include/linux/cpu.h */
static inline int suspend_disable_secondary_cpus(void) {}
static inline void suspend_enable_secondary_cpus(void) {}
```

## cpu subsystem driver

drivers/base/cpu.c

从设备模型的角度，抽象 CPU core 设备，并通过 sysfs 提供 CPU core 状态查询、hotplug 控制等接口。

```cpp
/* drivers/base/cpu.c */

const struct bus_type cpu_subsys = {
	.name = "cpu",
	.dev_name = "cpu",
	.match = cpu_subsys_match,
#ifdef CONFIG_HOTPLUG_CPU
	.online = cpu_subsys_online,
	.offline = cpu_subsys_offline,
#endif
#ifdef CONFIG_GENERIC_CPU_AUTOPROBE
	.uevent = cpu_uevent,
#endif
};
EXPORT_SYMBOL_GPL(cpu_subsys);

/* per-cpu 的 struct cpu 变量 */
DEFINE_PER_CPU(struct cpu, cpu_devices);

cpu_dev_init()
  /* 注册一个名为 cpu 的 subsystem
     /sys/devices/system/cpu/
     /sys/bus/cpu/ */
  subsys_system_register(&cpu_subsys, cpu_root_attr_groups)->subsys_register()
  cpu_dev_register_generic();
    for_each_present_cpu(i) { arch_register_cpu(i) }
      /* x86 架构，cpu0 不能热插拔 */
      c->hotpluggable = cpu > 0;
      register_cpu(c, cpu)

register_cpu()
  cpu->dev.bus = &cpu_subsys;
  device_register(&cpu->dev);
```

在这个 patch 里，移除了 `cpu0_hotplug` 参数。e59e74dc48a309cb848ffc3d76a0d61aa6803c05
[\[patch V4 05/37\] x86/topology: Remove CPU0 hotplug option - Thomas Gleixner](https://lore.kernel.org/all/20230512205255.715707999@linutronix.de/)

## smp

arch/x86/kernel/smp.c

平台相关，承担承上启下的角色，主要提供两类功能：

1. arch-dependent 的 SMP 初始化、CPU core 控制等操作
2. IPI（Inter-Processor Interrupts）相关的支持

```cpp
/*  */
struct smp_ops smp_ops = {
	.smp_prepare_boot_cpu	= native_smp_prepare_boot_cpu,
	.smp_prepare_cpus	= native_smp_prepare_cpus,
	.smp_cpus_done		= native_smp_cpus_done,
	.stop_other_cpus	= native_stop_other_cpus,
	.crash_stop_other_cpus	= kdump_nmi_shootdown_cpus,
	.smp_send_reschedule	= native_smp_send_reschedule,
	.kick_ap_alive		= native_kick_ap,		/*  */
	.cpu_disable		= native_cpu_disable,		/*  */
	.play_dead		= native_play_dead,
	.send_call_func_ipi	= native_send_call_func_ipi,
	.send_call_func_single_ipi = native_send_call_func_single_ipi,
};
EXPORT_SYMBOL_GPL(smp_ops);
/* 如果有 MADT，还会设置一些 ops */
start_kernel()->acpi_boot_init()->acpi_table_parse_madt()->acpi_parse_mp_wake()->acpi_mp_setup_reset()
  smp_ops.play_dead = acpi_mp_play_dead;
  smp_ops.stop_this_cpu = acpi_mp_stop_this_cpu;
  smp_ops.cpu_die = acpi_mp_cpu_die;



/* 1 号进程 kernel_init 运行在 boot cpu 上 */
kernel_init()->kernel_init_freeable()
  /* kernel/smp.c */
  smp_init()->bringup_nonboot_cpus()->cpuhp_bringup_cpus_parallel()->cpuhp_bringup_mask()
    cpu_up()->_cpu_up()->cpuhp_up_callbacks()->cpuhp_invoke_callback_range()->__cpuhp_invoke_callback_range()->cpuhp_invoke_callback()
      native_kick_ap()->do_boot_cpu()
        initial_code = (unsigned long)start_secondary;

/* cpu1 */
secondary_startup_64 /* arch/x86/kernel/head_64.S */
  callq	*initial_code(%rip) /* 也就是 start_secondary */
```

在 ARM 和 RISC-V 里没有 `struct smp_ops`，而是 `struct cpu_operations`

## cpu topology

drivers/base/arch_topology.c

ARM 和 RISC-V 会用到，从 Device Tree 里读取 cpu 信息。x86 默认不启用这个 `GENERIC_ARCH_TOPOLOGY`。

```cpp
/* include/linux/arch_topology.h */
struct cpu_topology {
	int thread_id;
	int core_id;
	int cluster_id;
	int package_id;
	cpumask_t thread_sibling;
	cpumask_t core_sibling;
	cpumask_t cluster_sibling;
	cpumask_t llc_sibling;
};
```

## cpu info 及其它

arch/arm64/kernel/cpuinfo.c

x86 用的是 cpuid？
