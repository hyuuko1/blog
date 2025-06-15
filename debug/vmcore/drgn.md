# drgn

- [drgn - Linux 调试的另一只翅膀 \[上\] - 知乎](https://zhuanlan.zhihu.com/p/514335495)
- [drgn - Linux 调试的另一只翅膀 \[下\] - 知乎](https://zhuanlan.zhihu.com/p/514375723)
- [drgn documentation](https://drgn.readthedocs.io/en/latest/index.html)
- [Using drgn on production kernels \[LWN.net\]](https://lwn.net/Articles/952942/)

案例

- [Stack Traces and Mystery Addresses (blk-rq-qos Crash) — drgn 0.0.31+1.g3977bdc documentation](https://drgn.readthedocs.io/en/latest/tutorials/blk_rq_qos_crash.html)
- [Dropping cache didn’t drop cache](https://blog.x.com/engineering/en_us/topics/open-source/2021/dropping-cache-didnt-drop-cache)

crash 命令要 6s，而 drgn 只需要 1s，功能还更强大。

##

```bash
❯ drgn -c /data/VMs/fedora_rootfs/var/crash/127.0.0.1-2025-04-23-17:53:48/vmcore -s /data/os-code/linux/out/x86_64/vmlinux
>>> task = find_task(1)
>>> trace = stack_trace(task)
>>> trace
#0  context_switch (out/x86_64/kernel/sched/core.c:5382:2)
#1  __schedule (out/x86_64/kernel/sched/core.c:6767:8)
#2  __schedule_loop (out/x86_64/kernel/sched/core.c:6845:3)
#3  schedule (out/x86_64/kernel/sched/core.c:6860:2)
#4  schedule_hrtimeout_range_clock (out/x86_64/kernel/time/sleep_timeout.c:207:3)
#5  ep_poll (out/x86_64/fs/eventpoll.c:2107:17)
#6  do_epoll_wait (out/x86_64/fs/eventpoll.c:2523:9)
#7  __do_sys_epoll_wait (out/x86_64/fs/eventpoll.c:2531:9)
#8  __se_sys_epoll_wait (out/x86_64/fs/eventpoll.c:2526:1)
#9  __x64_sys_epoll_wait (out/x86_64/fs/eventpoll.c:2526:1)
#10 do_syscall_x64 (out/x86_64/arch/x86/entry/syscall_64.c:63:14)
#11 do_syscall_64 (out/x86_64/arch/x86/entry/syscall_64.c:94:7)
#12 entry_SYSCALL_64+0xaf/0x14c (out/x86_64/arch/x86/entry/entry_64.S:121)
#13 0x7fd0c467d486

>>> trace[5]
#5 at 0xffffffff817b2137 (do_epoll_wait+0x3f7/0x47d) in ep_poll at out/x86_64/fs/eventpoll.c:2107:17 (inlined)

```
