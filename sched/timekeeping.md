##

不关闭 nohz 和 highres 时，timekeeping 会依次经过下列三个阶段？

```cpp
class_raw_spinlock_irqsave_constructor() (/data/os-code/linux/include/linux/spinlock.h:557)
timekeeping_advance() (/data/os-code/linux/kernel/time/timekeeping.c:2384)
update_wall_time() (/data/os-code/linux/kernel/time/timekeeping.c:2395)
tick_periodic(int cpu) (/data/os-code/linux/kernel/time/tick-common.c:98)
tick_handle_periodic(struct clock_event_device * dev) (/data/os-code/linux/kernel/time/tick-common.c:113)
timer_interrupt() (/data/os-code/linux/arch/x86/kernel/time.c:39)
__handle_irq_event_percpu(struct irq_desc * desc) (/data/os-code/linux/kernel/irq/handle.c:211)
handle_irq_event_percpu(struct irq_desc * desc) (/data/os-code/linux/kernel/irq/handle.c:248)
handle_irq_event(struct irq_desc * desc) (/data/os-code/linux/kernel/irq/handle.c:265)
handle_level_irq(struct irq_desc * desc) (/data/os-code/linux/kernel/irq/chip.c:694)
generic_handle_irq_desc(struct irq_desc * desc) (/data/os-code/linux/include/linux/irqdesc.h:172)
handle_irq(struct irq_desc * desc) (/data/os-code/linux/arch/x86/kernel/irq.c:255)
call_irq_handler(int vector, struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/irq.c:279)
__common_interrupt(struct pt_regs * regs, u32 vector) (/data/os-code/linux/arch/x86/kernel/irq.c:326)
common_interrupt(struct pt_regs * regs, unsigned long error_code) (/data/os-code/linux/arch/x86/kernel/irq.c:319)
```

```cpp
class_raw_spinlock_irqsave_constructor() (/data/os-code/linux/include/linux/spinlock.h:557)
timekeeping_advance() (/data/os-code/linux/kernel/time/timekeeping.c:2384)
update_wall_time() (/data/os-code/linux/kernel/time/timekeeping.c:2395)
tick_periodic(int cpu) (/data/os-code/linux/kernel/time/tick-common.c:98)
tick_handle_periodic(struct clock_event_device * dev) (/data/os-code/linux/kernel/time/tick-common.c:113)
local_apic_timer_interrupt() (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1045)
__sysvec_apic_timer_interrupt(struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1062)
instr_sysvec_apic_timer_interrupt(struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1056)
sysvec_apic_timer_interrupt(struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1056)
```

```cpp
class_raw_spinlock_irqsave_constructor() (/data/os-code/linux/include/linux/spinlock.h:557)
timekeeping_advance() (/data/os-code/linux/kernel/time/timekeeping.c:2384)
update_wall_time() (/data/os-code/linux/kernel/time/timekeeping.c:2395)
tick_nohz_update_jiffies(ktime_t now) (/data/os-code/linux/kernel/time/tick-sched.c:739)
tick_nohz_irq_enter() (/data/os-code/linux/kernel/time/tick-sched.c:1558)
tick_irq_enter() (/data/os-code/linux/kernel/time/tick-sched.c:1575)
irq_enter_rcu() (/data/os-code/linux/kernel/softirq.c:668)
instr_sysvec_apic_timer_interrupt(struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1056)
sysvec_apic_timer_interrupt(struct pt_regs * regs) (/data/os-code/linux/arch/x86/kernel/apic/apic.c:1056)
```
