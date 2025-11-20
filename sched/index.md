# 任务调度

- [任务调度器：从入门到放弃 - OPPO 内核工匠](https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzAxMDM0NjExNA==&action=getalbum&album_id=4008276724713586688)

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
      - 这个中断可能是 smp_send_reschedule() 发送的 IPI 中断，
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

---

中断处理程序返回用户模式或者内核模式时，可能发生调度。

```cpp
irqentry_exit()
  if (user_mode(regs))
    irqentry_exit_to_user_mode()->exit_to_user_mode_prepare()
      if (unlikely(ti_work & EXIT_TO_USER_MODE_WORK))
        exit_to_user_mode_loop()
          if (ti_work & (_TIF_NEED_RESCHED | _TIF_NEED_RESCHED_LAZY))
            schedule(); /* 调度 */
  else if (!regs_irqs_disabled(regs))
    if (IS_ENABLED(CONFIG_PREEMPTION)) irqentry_exit_cond_resched();
      raw_irqentry_exit_cond_resched()
        if (!preempt_count())
          if (need_resched())
            preempt_schedule_irq();
              __schedule(SM_PREEMPT); /* 调度 */
```

调度

```cpp
__schedule(int sched_mode)
  next = pick_next_task(rq, rq->donor, &rf);
  clear_tsk_need_resched(prev); /* 清除 _TIF_NEED_RESCHED | _TIF_NEED_RESCHED_LAZY */
  clear_preempt_need_resched(); /* 清楚 preempt_count 里的 PREEMPT_NEED_RESCHED */
  context_switch(rq, prev, next, &rf);
```

---

疑问

- [ ] cfs 和 eevdf 都是 fair_sched_class 的实现？cfs 已被 eevdf 取代，现在的代码里只有 eevdf 没有 cfs？
