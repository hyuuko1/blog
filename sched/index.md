# 任务调度

推荐阅读：[](../好文章/调度.md)

| 调度类                      | 调度策略       | 调度算法 | 调度对象 |
| --------------------------- | -------------- | -------- | -------- |
| 停机调度类 stop_sched_class | 无             |          |          |
| 限期调度类 dl_sched_class   | SCHED_DEADLINE |          |          |
| 实时调度类 rt_sched_class   | SCHED_FIFO     |          |          |
|                             | SCHED_RR       |          |          |
| 公平调度类 fair_sched_class | SCHED_NORMAL   |          |          |
|                             | SCHED_BATCH    |          |          |
|                             | SCHED_IDLE     |          |          |
| scx 调度类 ext_sched_class  | SCHED_EXT      |          |          |
| 空闲调度类 idle_sched_class | 无             |          |          |

- 进程优先级
- 调度类、调度策略、调度算法
  - 进程优先级对应的权重
  - vruntime
  - 调度最小粒度
  - 调度周期
- 任务分组
  - 调度器的调度对象是进程或者任务组
  - 自动分组 CONFIG_SCHED_AUTOGROUP
    - struct autogroup
    - /proc/sys/kernel/sched_autogroup_enabled
    - kernel/sched/auto_group.c
  - CPU 控制组
    - CONFIG_CGROUP_SCHED
      - CONFIG_FAIR_GROUP_SCHED
      - CONFIG_RT_GROUP_SCHED
    - `echo <weigth> > cpu.weight` 指定权重
    - `echo <pid> > cgroup.procs` 将线程组加入控制组
      - 使用线程化的 cgroup，可以把同一线程组内的不同线程放入不同的控制组？
- 数据结构
  - struct sched_class
  - struct rq 运行队列，percpu 的
    - 包含很多个队列
      - struct dl_rq
      - struct rt_rq
      - struct cfs_rq
      - struct scx_rq
  - struct sched_entity 调度实体
  - struct task_group 任务组
    - 每个任务组在每个 cpu 上都有一个公平调度实体、实时调度实体等等
    - 每个任务组内每个 cpu 上也有一个公平调度队列、实体调度队列等等
    - 所以，在每个 cpu 上都形成了一个 n 叉树数据结构？
    - 特殊的 root_task_group 根任务组
    - 计算任务组 cfs sched_entity 的权重 `update_cfs_group()`
      - 公平调度实体的权重 = 任务组的权重 × 公平调度实体的负载比例
      - 公平调度实体的负载比例 = 公平运行队列的权重/（任务组的平均负载 − 公平运行队列的平均负载 + 公平运行队列的权重）
        - [ ] 为什么不是 公平运行队列的权重/任务组的平均负载，没看懂
      - 公平运行队列的权重 = 公平运行队列中所有调度实体的权重总和
      - 任务组的平均负载 = 所有公平运行队列的平均负载的总和
    - 在每个处理器上，任务组的实时调度实体的调度优先级，取实时运行队列中所有实时调度实体的最高调度优先级。

```cpp
struct task_group {
	/* 指向一个指针数组。任务组在每个 CPU 上都有一个 cfs 调度实体 */
	struct sched_entity	**se;
	/* 指向一个指针数组。任务组在每个 CPU 上的调度实体所属的 cfs 运行队列 */
	struct cfs_rq		**cfs_rq;

	/* 和 cfs 一样的，不过多解释了 */
	struct sched_rt_entity	**rt_se;
	struct rt_rq		**rt_rq;
};

struct sched_entity {
	/* 在调度树中的深度 */
	int				depth;
	/* 在调度树中的父亲，也就是一个任务组 */
	struct sched_entity		*parent;
	/* 该调度实体所属的 cfs 运行队列。如果该调度实体属于一个任务组，那么这个队列就是该任务组的队列 */
	struct cfs_rq			*cfs_rq;
	/* 调度实体拥有的 cfs 运行队列。任务组有这个队列，进程没有，根任务组没有。*/
	struct cfs_rq			*my_q;
};
```

---

- 核心函数 `__schedule()`
  - 参数 sched_mode
    - SM_IDLE
    - SM_NONE
    - SM_PREEMPT 抢占
    - SM_RTLOCK_WAIT
  - 主要过程
    1. pick_next_task() 选择下一个 task
    2. context_switch() 上下文切换
       1. [ ] `switch_to()` 将来再深入。
- 调度时机
  - 进程主动调度
    - 用户态 syscall sched_yield() 或者在进行其他系统调用时因等待某个资源而主动调度出去。
    - schedule()
    - cond_resched()
    - might_resched()
  - 周期调度。时钟 tick
    - 限期调度类的周期调度
    - 实时调度类的周期调度
    - 公平调度类的周期调度
  - 唤醒进程时，被唤醒的进程可能抢占当前进程
    - 当前进程退出中断时，发生调度 irqentry_exit_cond_resched()->raw_irqentry_exit_cond_resched()->preempt_schedule_irq()
      - 这个中断可能是 smp_send_reschedule() 发送的 RESCHEDULE_VECTOR IPI 中断，
    - 唤醒指定进程
      - wake_up_process() 只会改 state 并放进 rq ？
    - 唤醒 wait_queue 队列里的
      - 一般最后会调用到 default_wake_function()->try_to_wake_up()
      - 有以下函数：
      - wake_up()
      - wake_up_interruptible()
      - ...
    - 可能会选择正在某个 cpu 上运行着的一个受害者，让被唤醒的进程会抢占那个进程？
      - 但还是得让那个进程调用到 `__schedule()` 才行？
  - 创建新进程时，新进程抢占当前进程
    - wake_up_new_task() 创建新进程时。很有可能会让出当前 cpu？
  - 内核抢占
    - 内核抢占是指当进程在内核模式下运行的时候可以被其他进程抢占。有以下抢占点：
    - preempt_enable() 开启抢占时
      - spin_unlock() 释放自旋锁时
    - local_bh_enable() 开启软中断时
    - irqentry_exit()->irqentry_exit_cond_resched() 中断处理程序返回内核模式时，
      - 这个中断可能是别的进程 smp_send_reschedule() 发送的 IPI，也可能是时钟中断或外设中断？
  - 用户抢占
    - 在用户态运行时被抢占。
    - irqentry_exit()->irqentry_exit_to_user_mode()
  - 高精度时钟。
- 抢占点
  - 抢占。某个进程被唤醒后，给当前进程设置 `TIF_NEED_RESCHED`，并且可能发 IPI 啥的。
- 各种 CONFIG
  - 调度抢占相关
    - CONFIG_PREEMPT_NONE: No Forced Preemption (Server)
      - 可以 `cond_resched()` 自愿让出，别人没法抢。
    - CONFIG_PREEMPT_VOLUNTARY: Voluntary Kernel Preemption (Desktop)
      - 可以 `cond_resched()` 自愿让出，别人没法抢。
      - `might_sleep()` 在此 CONFIG 下，包含了 `cond_resched()` 的作用。
    - CONFIG_PREEMPT: Preemptible Kernel (Low-Latency Desktop)
    - CONFIG_PREEMPT_LAZY: Scheduler controlled preemption model
      - https://lore.kernel.org/all/20241007075055.331243614@infradead.org/
    - CONFIG_PREEMPT_RT: Fully Preemptible Kernel (Real-Time)
      - https://lore.kernel.org/all/alpine.DEB.2.21.1907172200190.1778@nanos.tec.linutronix.de/
    - CONFIG_PREEMPT_DYNAMIC: Preemption behaviour defined on boot 允许在通过内核启动参数来选择抢占模型
      - 详见 `__sched_dynamic_update()`，可以看到使用不同的抢占模型时对 cond_resched/might_resched 等函数的启用/禁用。
  - 其他
    - CONFIG_SCHED_CORE
    - CONFIG_SCHED_CLASS_EXT
- 带宽管理
  - 限期调度类的带宽管理
  - 实时调度类的带宽管理
  - 公平调度类的带宽管理
    - cpu cgroup
- 进程的处理器亲和性
  - 系统调用 sched_setaffinity() 和 sched_getaffinity()
  - 内核线程 kthread_bind() 和 set_cpus_allowed_ptr()
  - cpuset cgroup
- 处理器负载均衡
  - 限期调度类的处理器负载均衡
  - 实时调度类的处理器负载均衡
  - 公平调度类的处理器负载均衡
    - 调度域和调度组
    - 负载均衡算法
- 迁移线程
- 隔离处理器
  - isolcpus=
- 进程的安全上下文
  - cred

## 自愿与非自愿调度

- [Linux 调度 - 切换类型的划分 - 兰新宇](https://zhuanlan.zhihu.com/p/402423877)

判断是自愿还是非自愿的流程；

1. 如果是 SM_IDLE，那就是自愿。
2. 如果是 SM_PREEMPT 或者 TASK_RUNNING，那就是非自愿。
3. 其余都是自愿。

```cpp
struct task_struct {
	/* Context switch counts: */
	unsigned long			nvcsw;  /* Number of Voluntary Context SWitches */
	unsigned long			nivcsw; /* Number of InVoluntary Context SWitches */
};
```

```bash
❯ gcc -x c - <<EOF
#include <sched.h>
#include <unistd.h>
int main() {
	while (1) { sched_yield(); }	// 非自愿切换
	// while (1) { sleep(1); }	// 自愿切换
}
EOF

❯ ./a.out &
❯ pidstat -w 1 -p `pidof a.out`
# 注意不要与 task_struct 中的变量名混淆
# cswch:   Voluntary Context SWitCHes
# nvcswch: Non-Voluntary Context SWitCHes
#                              自愿    非自愿
20:27:40      UID       PID   cswch/s nvcswch/s  Command
20:27:41     1000     19364      0.00     64.00  a.out
20:27:42     1000     19364      0.00    129.00  a.out
20:27:43     1000     19364      0.00     59.00  a.out

❯ grep switch /proc/`pidof a.out`/sched
nr_switches                                  :                 3174
nr_voluntary_switches                        :                    0
nr_involuntary_switches                      :                 3174

❯ crash /path/to/vmlinux /proc/kcore
crash> task 1
PID: 1        TASK: ffff888180078000  CPU: 1    COMMAND: "systemd"
crash> task_struct.nvcsw -o ffff888180078000
struct task_struct {
  [ffff888180078c18] unsigned long nvcsw;
}
# 使用 systemtap 的 watchpoint 功能，当这个计数被修改时，打印出 back trace
❯ stap -v -e 'probe kernel.data(0xffff888180078c18).write { print_backtrace(); }'
```

## 调度时机

- [Linux 中执行调度的时机 - 知乎](https://zhuanlan.zhihu.com/p/402340888)

先做个总结：

调度有两种，主动调度和抢占调度。抢占调度分为两种，用户态抢占和内核态抢占。

- 无论何种 CONFIG，都是支持用户态抢占的：中断/异常/系统调用返回用户态时，检查到 `_TIF_NEED_RESCHED` 或 `_TIF_NEED_RESCHED_LAZY` flag 就会调度。
- 不同的 CONFIG 对内核态抢占的支持程度不一。
  - 未设置 `CONFIG_PREEMPTION`，不支持内核态抢占的 CONFIG 有：
    - CONFIG_PREEMPT_NONE 只能自愿调度出去：`cond_resched()` 或 `schedule()`
    - CONFIG_PREEMPT_VOLUNTARY 有比前者更多的自愿调度点：前者在 `might_sleep()` 中不会自愿调度
  - `CONFIG_PREEMPTION=y` 意味着支持内核态抢占，在设置为 =y 后，会产生这些区别：
    1. `preempt_enable()/preempt_enable_notrace()/preempt_check_resched()` 满足一定条件时会触发调度
    2. 在内核态发生中断后，中断处理程序结束退出时 `irqentry_exit_cond_resched()` 满足一定条件时会触发调度。
    3. `cond_resched()` 和 `might_sleep()` 都不可能触发调度了。这是因为，现在，在任意满足 `preemptible() == true` 的地方，都可以直接被 `smp_send_reschedule()` 发送 IPI 中断，在中断退出时被抢占，已经不需要这两个函数了。
    4. 依赖于该 CONFIG 的有：
       - CONFIG_PREEMPT
       - CONFIG_PREEMPT_RT 比前者更进一步：
         1. “不允许被抢占的地方”更少：包括自旋锁在内的某些位置不会 `preempt_disable()` 禁止抢占
       - [ ] CONFIG_PREEMPT_LAZY。目的是替代 CONFIG_PREEMPT_VOLUNTARY

看以下几处代码就很好理解这些 CONFIG 是如何影响具体的代码逻辑的：

1. CONFIG_PREEMPTION 对 `preempt_enable()/preempt_enable_notrace()/preempt_check_resched()` 等函数的影响
2. `__sched_dynamic_update()` 里对几个 static call 的启用和禁用

### 主动调度：`cond_resched()` 等函数

- `schedule()` 主动调度
- `cond_resched()` 满足条件时自愿调度（其实并未统计为 ）
- `might_sleep()` 主要用于 debug，但是当 `CONFIG_PREEMPT_VOLUNTARY=y` 时，隐含了 `cond_resched()` 的效果

### 内核态抢占：`preempt_enable()` 等函数

`CONFIG_PREEMPTION=y` 支持内核抢占后，以下函数检查到 current task 需要被抢占，并且 `preemptible() == true` 时，就会发生调度。

调度需要满足以下条件时：

1. `preempt_count() == 0` （注意，此处不包含 PREEMPT_NEED_RESCHED）
2. 未关闭本地中断

要抢占当前运行在内核态的线程，除了要满足以上两个条件外，还需满足一个条件：

3. current task 需要被抢占，有两种检查方式：
   1. thread_info 内的 TIF_NEED_RESCHED 被置位
   2. preempt_count 内的 PREEMPT_NEED_RESCHED 被清楚

`preempt_enable()` 等函数会先检查 preempt_count 的值是否为 0，一次性检查是否满足上述的第 1、3 点条件，满足条件后再去 `preempt_schedule()->preemptible()` 进一步检查。

`CONFIG_PREEMPTION=y` 支持内核抢占后，当检查到满足以上条件时，就会发生调度，有以下检查点：

- `preempt_enable()` 开抢占时检查。在内核中被大量使用：
  - `spin_unlock()`
  - `spin_trylock()`
  - ...
- `preempt_enable_notrace()`
- `preempt_check_resched()`，此为内部 API，主要被用于在启用 bottom-half 时检查：
  - `local_bh_enable()`
  - `spin_unlock_bh()`
  - `spin_trylock_bh()`
  - ...

### 内核态抢占、用户态抢占：中断/异常处理程序退出

- 内核态抢占：中断/异常处理程序返回到中断前的内核态上下文之前
- 用户态抢占：中断/异常处理程序返回到中断前的用户态上下文之前

注：在 x86，中断/异常处理程序退出时都会调用 `irqentry_exit()`

```cpp
irqentry_exit()
  if (user_mode(regs))
    irqentry_exit_to_user_mode()->exit_to_user_mode_prepare()
      if (unlikely(ti_work & EXIT_TO_USER_MODE_WORK))
        exit_to_user_mode_loop()
          if (ti_work & (_TIF_NEED_RESCHED | _TIF_NEED_RESCHED_LAZY))
            schedule(); /* 用户态抢占。此时不算是内核抢占，因为是在用户态被中断的 */
  else if (!regs_irqs_disabled(regs)) /* 如果发生中断时，是在内核态，而且是开中断的状态 */
    if (IS_ENABLED(CONFIG_PREEMPTION)) irqentry_exit_cond_resched();
      raw_irqentry_exit_cond_resched()
        /* TODO 这里可以改为像 preempt_enable() 中那样使用 PREEMPT_NEED_RESCHED 优化后的检查方式吗？*/
        if (!preempt_count())
          if (need_resched()) /* 检查 TIF_NEED_RESCHED */
            preempt_schedule_irq();
              __schedule(SM_PREEMPT); /* 内核抢占 */
  else /* 如果发生中断时，是在内核态，而且是关中断的状态，说明中断前是不满足内核态抢占的条件的，
          例如，1. 中断前是在中断处理函数中，此次中断是 nmi 中断 2. 中断前在 spin_lock_irq() 的临界区中 */
```

### 用户态抢占：系统调用退出

系统调用返回时，可能发生调度

```cpp
syscall_exit_to_user_mode()
  syscall_exit_to_user_mode_work()
    exit_to_user_mode_prepare()
      if (unlikely(ti_work & EXIT_TO_USER_MODE_WORK))
        exit_to_user_mode_loop()
          if (ti_work & (_TIF_NEED_RESCHED | _TIF_NEED_RESCHED_LAZY))
            schedule();
```

中断和异常处理详见 [irq/index.md](/irq/index.md)

## 调度标记的时机

- [Linux 中执行调度的时机 - 知乎](https://zhuanlan.zhihu.com/p/402340888)

```cpp
__resched_curr()

/* 给 rq->idle 设置 */
wake_up_idle_cpu()
  set_nr_and_not_polling(task_thread_info(rq->idle), TIF_NEED_RESCHED)

/* idle_inject_timer_fn() 以及 tree rcu 会调用这个设置 TIF_NEED_RESCHED */
set_tsk_need_resched()
```

```bash
sudo bpftrace -e 'fentry:vmlinux:__resched_curr { @[kstack] = count(); }'
```

结果放在 [](./resched_curr.md) 了，

## TIF_NEED_RESCHED

用于标记线程需要被重新调度。

## PREEMPT_NEED_RESCHED

也用于标记线程需要被重新调度。

是一个小优化，先看看 AI 的讲解 [PREEMPT_NEED_RESCHED](./PREEMPT_NEED_RESCHED.md)（不完全正确）。

邮件讨论：

- [\[RFC\]\[PATCH 0/5\] preempt_count rework - Peter Zijlstra](https://lore.kernel.org/lkml/20130814131539.790947874@chello.nl/)
- [\[PATCH 00/11\] preempt_count rework -v3 - Peter Zijlstra](https://lore.kernel.org/lkml/20130917082838.218329307@infradead.org/) <br>
  主要做了两个对 `preempt_enable()` 的优化。还展示了优化前后的汇编指令对比。
  1. `f27dde8deef3` 2013-09-25 sched: Add NEED_RESCHED to the preempt_count <br>
     将 preempt_count（是否允许抢占）和 need_resched（是否需要抢占）两个检查 fold 为一个，这样一来，`preempt_enable()` 只需要在 preempt_count -1 后检查其是否为 0，无需检查 current 的 `TIF_NEED_RESCHED` flag。 <br>
     实现原理：让 `PREEMPT_NEED_RESCHED` 作为 `TIF_NEED_RESCHED` 在 preempt_count 里的“影子”：
     1. 让 preempt_count 的初始值就默认包含 `PREEMPT_NEED_RESCHED`
     2. 当 current task 需要被 resched 时，就清除 `PREEMPT_NEED_RESCHED`
  2. `c2daa3bed53a` 2013-09-25 sched, x86: Provide a per-cpu preempt_count implementation <br>
     x86 使用 per-cpu 的 preempt_count，相比于通过 thread_info 访问，要更快一些。
- [\[tip:sched/core\] sched: Add NEED_RESCHED to the preempt_count - tip-bot for Peter Zijlstra](https://lore.kernel.org/lkml/tip-7a7m5qqbn5pmwnd4wko9u6da@git.kernel.org/)

其他的一些个人理解，不一定对：

- 对 preempt_count 的修改频率极高，要避免对 preempt_count 进行 atomic 操作，所以现在没有提供 remotely 修改 preempt_count 的 API（初始化操作除外，只能被当前的 cpu 访问（虽然强行用 per_cpu() 也能访问）。

## 关于 might_sleep()

在开启 CONFIG_DEBUG_ATOMIC_SLEEP 时，might_sleep() 比 might_resched() 多了一些检测，在未开启时，这两个并无区别。因此，使用 might_sleep() 而非 might_resched()，后者只是一个内部接口。

那 might_sleep() 和 cond_resched() 是什么区别呢？

- 在开启 CONFIG_DEBUG_ATOMIC_SLEEP 时，前者比后者多了一个 WARN，有助于尽早发现问题。
- 在 CONFIG_PREEMPT_NONE 时，前者不生效，后者生效，其他 CONFIG 时，二者行为一致。
- 前者用于提示：后面的操作可能发生调度。本身也有自愿调度的作用，但并不是其主要用途。
  - [ ] 我觉得不应该让 might_sleep() 有主动调度的作用啊，应该只保留 debug 提示的作用，因为后面可能就马上要发生调度了。而且如果此时调度，那么可能就导致可能会立即成功的 wait_event() 之类的更晚执行了，导致延迟变高？
- 后者一般在很耗时且不会调度出去的 while 循环中使用，增加自愿调度点，防止非抢占式内核里一直占着 cpu，造成软死锁。

---

比较关键的一些函数，先记在这里，

- wakeup_preempt()
- resched_curr() 和 resched_curr_lazy()
- pick_next_task()

## 周期性调度

```cpp
update_process_times()->sched_tick()

fentry:vmlinux:sched_tick
```

在 [](./resched_curr.md) 中有调用栈。

## 组调度

- [ ] 暂时忽略组调度。目前遇到涉及到组调度的地方有：
  - pick_next_task_fair()

注意组调度与调度组（负载均衡中的概念）的区别。

## 负载均衡

- [Linux 调度负载均衡之 sched_domain - 知乎](https://zhuanlan.zhihu.com/p/702021310)

## 关键函数代码流程

### `__schedule()`

`__schedule()` 函数的注释，翻译一下：

驱使调度器运行并因此进入本函数的主要途径如下：

1. **显式阻塞**（Explicit blocking）：
   例如互斥锁（mutex）、信号量（semaphore）、等待队列（waitqueue）等机制。
2. **在中断返回和用户空间返回路径上**检查 TIF_NEED_RESCHED 标志：
   例如调度器会在定时器中断处理函数 sched_tick() 中设置该标志。
3. 唤醒（Wakeups）本身并不会直接导致进入 schedule()，它们只是将一个任务添加到 run-queue 中，仅此而已。
   不过，如果**新加入运行队列的任务抢占了当前任务**（例如优先级更高），那么唤醒操作会设置 TIF_NEED_RESCHED 标志，并且 schedule() 会在最近的可能时机被调用：
   - 如果内核是可抢占的（CONFIG_PREEMPTION=y）：
     - 在系统调用或异常上下文中，发生在下一次最外层的 preempt_enable() 调用时。（这甚至可能快到就在 wake_up() 内部释放自旋锁 spin_unlock() 的那一刻！）
     - 在中断（IRQ）上下文中，发生在从中断处理函数返回到可抢占上下文（内核态）的时候。
   - 如果内核是不可抢占的（未设置 CONFIG_PREEMPTION），则发生在下述最近的时间点：
     - 调用 cond_resched() 时
     - 显式调用 schedule() 时
     - 从系统调用或异常返回用户空间时
     - 从中断处理函数返回用户空间时

---

进入 `__schedule()` 时，必须是关抢占的，
这是为了防止重入这个函数？因为如果此时发生中断，可能在中断返回路径上又进这个函数

---

注释里没提到，但我觉得还存在的一个约束是：进入 `__schedule()` 时，必须是开中断的。
我这样推断的理由：

1. `__schedule()` 里会先 `local_irq_disable()` 然后在 `context_switch()->switch_to()` 结束后，等到下一次调度回来时，在 `context_switch()->finish_task_switch()->finish_lock_switch()->raw_spin_rq_unlock_irq()->local_irq_enable()` 开启中断，因此离开 `__schedule()` 时一定是开中断的。
2. `__cond_resched()` 里如果检测到是 `irqs_disabled()`，则不会进入 `preempt_schedule_common()->__schedule()`
3. 只用于中断处理函数返回用户态时的 `preempt_schedule_irq()` 会先 `local_irq_enable()` 再 `__schedule()`
4. 只用于中断处理函数返回内核态时的 `exit_to_user_mode_loop()` 会先 `local_irq_enable_exit_to_user()->local_irq_enable()` 再 `schedule()`
5. `__might_resched()` 里如果检测到 `irqs_disabled()`，会产生报错日志。

---

现在来看看主要流程吧：

```cpp
__schedule(int sched_mode)
  /* 关闭中断，我觉得是因为中断上下文也有可能获取 rq->__lock 造成死锁 */
  local_irq_disable();
  /* 其他 cpu 此时可能也在操作当前 cpu 的 rq 数据 //XXX 主要是负载均衡相关的代码？  */
  rq_lock(rq, &rf);

  next = pick_next_task(rq, rq->donor, &rf);
  clear_tsk_need_resched(prev); /* 清除 _TIF_NEED_RESCHED | _TIF_NEED_RESCHED_LAZY */
  clear_preempt_need_resched(); /* 清楚 preempt_count 里的 PREEMPT_NEED_RESCHED */
  context_switch(rq, prev, next, &rf);
    switch_to()->__switch_to_asm()->__switch_to()
      raw_cpu_write(current_task, next_p); /* 修改 percpu 的 current() */
```

```cpp
pick_next_task()
  __pick_next_task()

__pick_next_task()
  p = pick_next_task_fair(rq, prev, rf);
    p = pick_task_fair(rq);
  return p;
```

```cpp
switch_to()
```

---

### 唤醒线程 `try_to_wake_up()`

- [ ] 暂不关注内存屏障等同步原语，先看主要逻辑。
  - 一个 task_struct 可能同时在 schedule() 和被 try_to_wake_up()
- [ ] 可以在 softirq/hardirq context 使用吗？

schedule() 是 dequeue task，
try_to_wake_up() 是 enqueue task？

此函数对 schedule()函数（该函数会从队列中取出任务）具有原子性。在访问@p->state 之前，它会发出一个完整的内存屏障，请参阅 set_current_state()函数的注释。

If the task was not queued/runnable, also place it back on a runqueue.

1. `guard(preempt)();` 在当前作用域禁止内核抢占：在此处 `preempt_disable()` 禁止抢占，离开作用域时 `preempt_enable()` 开启抢占。
   ```cpp
   /* include/linux/preempt.h 定义了这个 scope-based cleanup helper */
   DEFINE_LOCK_GUARD_0(preempt, preempt_disable(), preempt_enable())
   ```
2. 场景: 进程自己调用唤醒自己（虽然少见，但在某些同步原语中可能发生）。
   - 因为是 current，进程肯定在 CPU 上运行，也肯定在运行队列（on_rq）上。不需要复杂的锁，直接检查状态是否匹配 (ttwu_state_match)，如果匹配，直接调用 ttwu_do_wakeup(p) 将状态改为 TASK_RUNNING。
   - 优化: 避免了获取 pi_lock 和 rq->lock 的开销。
3. waker 的 `wake_up_state()` 和 wakee 的 `set_current_state()` 里面都用到了 full memory barrier（位于以下伪码的 1 2 之间以及 A B 之间）。
   ```cpp
                        wakee					|		waker
        current->state = TASK_UNINTERRUPTIBLE; /* (1) STORE */	| CONDITION = 1;			/* (A) STORE */
        if (CONDITION)			/* (2) LOAD */		| if (p->state & TASK_UNINTERRUPTIBLE)	/* (B) LOAD */
                break;						| 	... 唤醒 wakee ...		/* (C) */
        schedule();			/* (3) */		|
   ```
   如果 1 2 之间以及 A B 之间没乱序，那么不论是 wakee 先执行完，还是 waker 先执行完，wakee 最后都不应睡眠。
   但是如果乱序了，顺序可能就是 2 -> B -> A -> 1 -> 3，导致：
   1. 因为 2 在 A 之前执行，所以 3 被执行了，wakee 睡眠。
   2. 因为 B 在 1 之前执行，所以 C 并没有被执行，wakee 未被唤醒。

```cpp
int try_to_wake_up(struct task_struct *p, unsigned int state, int wake_flags)
{
	/* 1 */
	guard(preempt)();
	int cpu, success = 0;

	wake_flags |= WF_TTWU;

	/* 2 */
	if (p == current) {
		WARN_ON_ONCE(p->se.sched_delayed);	/* TODO */
		if (!ttwu_state_match(p, state, &success))
			goto out;

		trace_sched_waking(p);
		ttwu_do_wakeup(p);
		goto out;
	}

	/* 获取 p->pi_lock，这是为了防止多个 cpu 唤醒同一个 task ？ */
	scoped_guard (raw_spinlock_irqsave, &p->pi_lock) {
		/* 3 */
		smp_mb__after_spinlock();
		if (!ttwu_state_match(p, state, &success))
			break;

		trace_sched_waking(p);

		/*
		 * Ensure we load p->on_rq _after_ p->state, otherwise it would
		 * be possible to, falsely, observe p->on_rq == 0 and get stuck
		 * in smp_cond_load_acquire() below.
		 *
		 * sched_ttwu_pending()			try_to_wake_up()
		 *   STORE p->on_rq = 1			  LOAD p->state
		 *   UNLOCK rq->lock
		 *
		 * __schedule() (switch to task 'p')
		 *   LOCK rq->lock			  smp_rmb();
		 *   smp_mb__after_spinlock();
		 *   UNLOCK rq->lock
		 *
		 * [task p]
		 *   STORE p->state = UNINTERRUPTIBLE	  LOAD p->on_rq
		 *
		 * Pairs with the LOCK+smp_mb__after_spinlock() on rq->lock in
		 * __schedule().  See the comment for smp_mb__after_spinlock().
		 *
		 * A similar smp_rmb() lives in __task_needs_rq_lock().
		 */
		smp_rmb();
		if (READ_ONCE(p->on_rq) && ttwu_runnable(p, wake_flags))
			break;

		/*
		 * Ensure we load p->on_cpu _after_ p->on_rq, otherwise it would be
		 * possible to, falsely, observe p->on_cpu == 0.
		 *
		 * One must be running (->on_cpu == 1) in order to remove oneself
		 * from the runqueue.
		 *
		 * __schedule() (switch to task 'p')	try_to_wake_up()
		 *   STORE p->on_cpu = 1		  LOAD p->on_rq
		 *   UNLOCK rq->lock
		 *
		 * __schedule() (put 'p' to sleep)
		 *   LOCK rq->lock			  smp_rmb();
		 *   smp_mb__after_spinlock();
		 *   STORE p->on_rq = 0			  LOAD p->on_cpu
		 *
		 * Pairs with the LOCK+smp_mb__after_spinlock() on rq->lock in
		 * __schedule().  See the comment for smp_mb__after_spinlock().
		 *
		 * Form a control-dep-acquire with p->on_rq == 0 above, to ensure
		 * schedule()'s deactivate_task() has 'happened' and p will no longer
		 * care about it's own p->state. See the comment in __schedule().
		 */
		smp_acquire__after_ctrl_dep();

		/*
		 * We're doing the wakeup (@success == 1), they did a dequeue (p->on_rq
		 * == 0), which means we need to do an enqueue, change p->state to
		 * TASK_WAKING such that we can unlock p->pi_lock before doing the
		 * enqueue, such as ttwu_queue_wakelist().
		 */
		WRITE_ONCE(p->__state, TASK_WAKING);

		/*
		 * If the owning (remote) CPU is still in the middle of schedule() with
		 * this task as prev, considering queueing p on the remote CPUs wake_list
		 * which potentially sends an IPI instead of spinning on p->on_cpu to
		 * let the waker make forward progress. This is safe because IRQs are
		 * disabled and the IPI will deliver after on_cpu is cleared.
		 *
		 * Ensure we load task_cpu(p) after p->on_cpu:
		 *
		 * set_task_cpu(p, cpu);
		 *   STORE p->cpu = @cpu
		 * __schedule() (switch to task 'p')
		 *   LOCK rq->lock
		 *   smp_mb__after_spin_lock()		smp_cond_load_acquire(&p->on_cpu)
		 *   STORE p->on_cpu = 1		LOAD p->cpu
		 *
		 * to ensure we observe the correct CPU on which the task is currently
		 * scheduling.
		 */
		if (smp_load_acquire(&p->on_cpu) &&
		    ttwu_queue_wakelist(p, task_cpu(p), wake_flags))
			break;

		/*
		 * If the owning (remote) CPU is still in the middle of schedule() with
		 * this task as prev, wait until it's done referencing the task.
		 *
		 * Pairs with the smp_store_release() in finish_task().
		 *
		 * This ensures that tasks getting woken will be fully ordered against
		 * their previous state and preserve Program Order.
		 */
		smp_cond_load_acquire(&p->on_cpu, !VAL);

		cpu = select_task_rq(p, p->wake_cpu, &wake_flags);
		if (task_cpu(p) != cpu) {
			if (p->in_iowait) {
				delayacct_blkio_end(p);
				atomic_dec(&task_rq(p)->nr_iowait);
			}

			wake_flags |= WF_MIGRATED;
			psi_ttwu_dequeue(p);
			set_task_cpu(p, cpu);
		}

		ttwu_queue(p, cpu, wake_flags);
	}
out:
	if (success)
		ttwu_stat(p, task_cpu(p), wake_flags);

	return success;
}
```

## 其他

**立即要做的事**

- 看一些主要的流程的代码
  - [ ] `__schedule()`
    - [ ] eevdf 如何挑选下一个 task
    - [ ] 如何切换上下文
  - [ ] 如何唤醒指定进程
    - [ ] 何时设置 TIF_NEED_RESCHED
    - [ ] `__resched_curr()` 的调用路径
  - [ ] 时钟 tick
  - [ ] 组调度，带宽控制，分析数据结构联系
  - [ ] 负载均衡
  - [ ] idle

---

不着急做的事

- [ ] CONFIG_SCHED_PROXY_EXEC 代理执行，和 RT 以及 SCHED_EXT 不能共存。
- [ ] 看《趣谈 Linux 操作系统》
- [x] ttwu 是什么意思
  - Try To Wake Up
- [ ] kernel/sched/debug.c
- [ ] nohz 的情况下的时钟与调度

---

疑问

- [ ] cfs 和 eevdf 都是 fair_sched_class 的实现？cfs 已被 eevdf 取代，现在的代码里只有 eevdf 没有 cfs？

---

一些术语

- waker 和 wakee
  - waker 是唤醒者 task
  - wakee 是被唤醒的 task
