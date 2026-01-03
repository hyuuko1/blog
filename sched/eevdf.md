## 抢占与周期性调度

这是调度器的主动权回收机制。如果说 `pick_next_task()` 是“选王”，那么本节的逻辑就是“废黜”。在 EEVDF 架构下，抢占不再仅仅基于时间片的简单耗尽，而是基于**截止时间 (Deadline) 的承诺和滞后值 (Lag) 的保护**。

- 触发: 由硬件时钟中断驱动。频率通常为 100Hz 到 1000Hz。
- [ ] 但实际上有两种模式，Periodic tick 和 Dynamic tick，前者是周期性的，
  - 详见 http://www.wowotech.net/sort/timer_subsystem 和 /data/Notes-gitbook/old/time/architecture.md
  - nohz：cpu 空闲时，运行着 idle task，没有 tick
  - nohz_full：cpu 上只有一个任务时，也没必要 tick
  - [ ] 能否更进一步？只要保证一个 cpu 上有周期性 tick 就可以了，其他 cpu 上不管有多少个任务，只需要在给 task 分配时间片时，设置一个 timer 在时间片用完时触发就好了。
- 抢占触发：如果 `update_deadline` 返回 true（请求耗尽），或者任务不再受“运行至对等”保护 (`!protect_slice(curr)`)，`update_curr` 会调用 `resched_curr_lazy(rq)`，给当前任务打上 `TIF_NEED_RESCHED` 标记。
- hrtick 高精度定时器
  - 默认的 Tick 可能是 1ms 或 4ms。如果两个任务的配额分别是 0.5ms 和 0.5ms，标准的 Tick 机制无法精确切换，导致一个任务多跑，另一个任务延迟。
  - 如果任务还在运行（没有被抢占），但剩余的时间片小于一个 Tick 的长度，常规 Tick 无法精确捕捉结束点。
  - 此时如果开启了 HRTICK，会设置一个高精度定时器在未来的几微秒触发中断，实现亚 Tick 级的抢占。

```bash
bpftrace -e 'fentry:vmlinux:task_tick_fair { @[kstack] = count(); }'
```

```cpp
asm_sysvec_apic_timer_interrupt()->local_apic_timer_interrupt()
  event_handler:hrtimer_interrupt()->__hrtimer_run_queues()->__run_hrtimer()
    fn:tick_nohz_handler()
      tick_sched_do_timer()
        tick_do_update_jiffies64()
          update_wall_time() /* 更新墙上时间 */
      tick_sched_handle()
        update_process_times()
          run_local_timers()->hrtimer_run_queues()
          sched_tick()
            int cpu = smp_processor_id();
            struct rq *rq = cpu_rq(cpu);
            /* 核心 */
            task_tick:task_tick_fair(cpu_rq(cpu), donor, 0)
      /* 周期性 tick */
      hrtimer_forward(timer, now, TICK_NSEC);
      return HRTIMER_RESTART;


task_tick_fair(cpu_rq(cpu), donor, queued=0)
  for_each_sched_entity(se)
    cfs_rq = cfs_rq_of(se);
    entity_tick(cfs_rq, se, queued);
      update_curr(cfs_rq);
        if (resched || !protect_slice(curr))
          resched_curr_lazy(rq); /* 打上 TIF_NEED_RESCHED 标记 */
          clear_buddies(cfs_rq, curr);
      update_load_avg(cfs_rq, curr, UPDATE_TG);
      update_cfs_group(curr);
```

- 调用 sched_class->task_tick() 的地方
  - tick_work_cpu 的 sched_tick_remote()，用于在热插拔 cpu 流程里 sched_cpu_starting() 开启 cpu 的调度的。
  - tick_nohz_handler()
    - per-cpu 变量 struct tick_sched tick_cpu_sched 的 ts->sched_timer
    - 这个就是用于 tick 的定时器
  - hrtick()
    - per-cpu 变量 struct rq runqueues 的 rq->hrtick_timer
    - `pick_next_task_fair()->__set_next_task_fair()->hrtick_start_fair()->hrtick_start()` 等路径，让定时器在 deadline 触发。
    - 当定时器到期，触发硬件中断。当前任务被标记为需要调度，在中断返回用户态时立即执行切换。
      - 定时器的 expire 更新是啥样的？是只存在一个 expire 每次设置都会重置，还是每次设置都会加上一个新的 expire 时间？

### nohz 和 highres

注意，我用 `bpftrace -e 'fentry:vmlinux:update_wall_time { @[kstack] = count(); }'` 试了，发现几种情况：

- 不关闭 nohz 和 highres 时，在中断上下文进行 timekeeping，以及通过 timer 来 timekeeping，这两种方式。后者的调用路径在前文提到过了。
  ```cpp
  asm_sysvec_apic_timer_interrupt()->run_sysvec_on_irqstack_cond()->irq_enter_rcu()
    /* 如果此 cpu 在 tick_nohz_full_mask 内，或者当前是 idle task 并且是硬中断上下文，则 tick */
    tick_irq_enter()->tick_nohz_irq_enter()->tick_nohz_update_jiffies()->tick_do_update_jiffies64()->update_wall_time()
  ```
- `nohz=off`
  - 即使关闭 nohz，仍然会走 `hrtimer_interrupt()` 走 `tick_nohz_handler()` 更新墙上时间、更新进程时间、检查时间片
- `nohz=off highres=off` 关闭 nohz，并且关闭高精度定时器时，才会走这个路径：
  ```cpp
  asm_sysvec_apic_timer_interrupt()->local_apic_timer_interrupt()
    /* Periodic tick */
    event_handler:tick_handle_periodic()->tick_periodic()
      if (READ_ONCE(tick_do_timer_cpu) == cpu)
        update_wall_time() /* timekeeping */
      update_process_times() /* 更新进程时间、检查时间片 */
  ```

---

- [ ] sched_yield() 是非自愿切换，因为此时 task 的 status 仍然是 TASK_RUNNING，仍然在 rq 里（虽然在 delay queue 的情况下，非 TASK_RUNNING 的 task 也会留在 rq 里）。

### [ ] TIF_NEED_RESCHED_LAZY

## 唤醒抢占检查

- `check_preempt_wakeup_fair()`
- 触发: 当 `try_to_wake_up()` 唤醒一个任务 p 时，如果 p 的优先级属于 Fair 类，且 p 不在当前 CPU 上运行。
- 新唤醒的任务 (pse) 试图将当前运行的任务 (se) 挤下 CPU。

```cpp
try_to_wake_up()
  ttwu_runnable()
    if (!task_on_cpu(rq, p))
      wakeup_preempt()
        if (p->sched_class == rq->donor->sched_class)
          wakeup_preempt:check_preempt_wakeup_fair()
  ttwu_queue()
    ttwu_do_activate()
      activate_task()
      wakeup_preempt()


check_preempt_wakeup_fair()
```

```bash
bpftrace -e 'fentry:vmlinux:check_preempt_wakeup_fair { @[kstack] = count(); }'

```

## 其他

### 抢占粒度与保护：`protect_slice()`

- 逻辑: 在 EEVDF 中，取代传统“唤醒粒度”的是“保护切片”概念。
- 计算:
  - se->vprot 是保护截止时间。
  - 当 se->vruntime < se->vprot 时，任务受到保护。见 update_curr()->protect_slice()
- 一旦我上台，我有权至少跑完这个最小切片，除非遇到更紧急的短任务。

##

eevdf 引入了基于 Deadline 的确定性抢占逻辑，取代了过去 CFS 中较为模糊的 wakeup_granularity 启发式算法。
