## task_struct

在 Linux 内核的视角里，**不存在一个与“进程”截然不同的、叫做“线程”的东西**。

内核里只有一种东西，叫做 **“执行上下文”**（Execution Context），或者更广为人知的名字——**任务（Task）**。每一个任务都由一个 `task_struct` 结构体来描述。这个 `task_struct` 是内核中最为庞大、最为复杂的数据结构之一，它包含了运行一个程序所需要的所有信息：进程 ID（PID）、内存空间（`mm_struct`）、文件描述符表（`files_struct`）、信号处理（`sighand_struct`）、CPU 状态、调度信息等等。

“线程”，在内核看来，**只是一种特殊配置的任务（task）**。所谓的进程和线程，只是用户态库（比如 glibc 的 NPTL）为了遵循 POSIX 标准，利用内核提供的灵活的“任务”创建机制，配置出来的不同共享程度的“任务”而已。

## clone3()

通过 flags，你可以精确地控制创建的新任务与旧任务共享哪些资源，不共享哪些资源。这就是 Linux 进程/线程模型的精髓：**资源共享的精细化控制**。

指定 CLONE_THREAD 时，必须要指定 CLONE_SIGHAND。
指定 CLONE_SIGHAND 时，必须要指定 CLONE_VM。
这些都在 `copy_process()` 中有所体现。

---

##

```cpp
struct task_struct {
	/* int 类型 */
	/* gettid() 获取的是 pid */
	pid_t				pid;
	/* getpid() 系统调用获取的，实际上是当前任务所在线程组的 tgid */
	pid_t				tgid;

	/* PID/PID hash table linkage. */
	struct pid			*thread_pid;
	struct hlist_node		pid_links[PIDTYPE_MAX];
	struct list_head		thread_node;
};
```

##

- [信号处理 SIGCHLD 的作用](../other/signal.md)

## pthread

pthread_create() 用 clone3() 创建线程，flags 带 CLONE_THREAD, CLONE_SIGHAND, CLONE_VM 等等

写一个 pthread 的示例程序，然后用 strace -f 跟踪可知，`pthread_create()` 调用的是 `clone3()` 系统调用，

```cpp
struct clone_args {
	__aligned_u64 flags;
	__aligned_u64 pidfd;
	__aligned_u64 child_tid;
	__aligned_u64 parent_tid;
	__aligned_u64 exit_signal;
	__aligned_u64 stack;
	__aligned_u64 stack_size;
	__aligned_u64 tls;
	__aligned_u64 set_tid;
	__aligned_u64 set_tid_size;
	__aligned_u64 cgroup;
};

clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0x7fa2c5bff990, parent_tid=0x7fa2c5bff990, exit_signal=0, stack=0x7fa2c53ff000, stack_size=0x7fff80, tls=0x7fa2c5bff6c0} => {parent_tid=[32892]}, 88) = 32892
```

以下问题详见 https://aistudio.google.com/u/1/prompts/1h80e8TCAkVm8vaaYikZlDSMpAj4qsW1v

- syscall exit() 只会退出当前线程，需要 syscall exit_group() 才能结束进程。
  - glibc 里的 exit() 库函数用的就是 exit_group()。
  - 当一个线程组的最后一个线程退出时，内核会自动执行 exit_group() 的逻辑？
- 如何等待子线程退出？
  - 用 syscall waitpid() 会返回错误 -ECHILD
  - 只能用 pthread_join()。其原理是什么？
    - 用到了 futex 和 CLONE_CHILD_CLEARTID，详见内核代码 mm_release()->do_futex()
- 如果主线程直接 return 0，没有 pthread_join()，会发生什么？
  - return 0 后会 exit_group() 进程结束，线程也被内核回收。
  - 如果主线程 syscall exit() 呢？主线程的 exit_state 会是 EXIT_ZOMBIE，task_struct 不会被释放。
    - exit_notify() 内的 autoreap = thread_group_empty(tsk) && do_notify_parent(tsk, tsk->exit_signal); 结果是 false
    - 子线程不会变为主线程
- pthread_create() 创建线程时传入了函数指针 start_routine，如果该函数结束了，但并没有对其 pthread_join()，线程会被销毁吗？
  - 会销毁。实际上线程的真正入口函数是 NPTL 里的 start_thread() 函数，其调用 start_routine() 结束后，会 syscall exit()，可以用 strace -f 进行观察。
  - task_struct 会释放吗？会释放。
    - do_exit()->exit_notify() 时，autoreap 是 true，使得 tsk->exit_state = EXIT_DEAD; 并放进 dead 链表，最后被 release_task() 释放。
- 我的思考。
  - 等待进程/线程结束的一个目的是为了得到进程/线程的退出状态。
  - 为什么等待线程不需要依赖 waitpid() 系统调用来完成？而等待进程需要？我觉得是因为线程组内的线程是共享内存的，而进程之间不一定能共享，所以等待进程结束需要依靠系统调用。waitpid() 更像是一种进程间通信机制（获取子进程的退出状态）？
- execve() 时会发生什么？旧的线程会咋样？
- 如何 kill 子线程？通过 tgkill() 发送信号？
- 如果不使用 CLONE_THREAD，而是直接 `clone(flags=CLONE_VM|CLONE_FS|CLONE_FILES)`，会发生什么？
  - 创建的实际上是子进程而非线程！该子进程共享内存、文件等资源，但是不在同一个线程组内！getpid() 获取到的是不同的进程 ID，并且可以用 waitpid() 等待其退出。
  - 这体现了 Linux 内核的哲学：不强制规定策略，只提供灵活的机制。
  - 但是，在几乎所有情况下，你都不要创建这样的“混合体”！
- [ ] TLS 线程局部存储实现原理
- [ ] pthread_detach()，何意味？线程退出时，会自动清理 nptl 用户态 TCB 而无需等到 pthread_join() 时才清理？也就是在认为该线程是不会被 pthread_join() 时，可以这样 detach？
- 僵尸进程。
  - 是指一个子进程已经结束，但其父进程没有调用 wait() 或 waitpid() 来收集其退出状态信息，task_struct 仍然存在。详见 do_exit()->exit_notify()
- 内核里如何判断是否是主线程的？
  - thread_group_leader() 看 task_struct.exit_signal 是否 >= 0

来看看 nptl 的代码

```cpp
/* nptl/pthread_create.c */
create_thread()
  /* 线程入口是 start_thread */
  int ret = __clone_internal (&args, &start_thread, pd);

start_thread()
  struct pthread *pd = arg;
  ret = pd->start_routine (pd->arg);
  /* 保存返回值到 TCB 中，pd->result，将来可能 pthread_join() 会取走这个值 */
  THREAD_SETMEM (pd, result, ret);
  /* 如果是最后一个线程，则用 glib 的 exit(0) 终止进程 */
  if (__glibc_unlikely (atomic_fetch_add_relaxed (&__nptl_nthreads, -1) == 1))
    /* This was the last thread.  */
    exit (0);
  /* syscall exit(0) */
  while (1)
    INTERNAL_SYSCALL_CALL (exit, 0);
```

## release_task

一些术语

- reap，收割，即：将已退出进程的残留元数据（主要是 task_struct 中的退出状态、PID、资源统计等）回收，并彻底释放其内核对象的过程。
  - 进程退出即立刻释放所有资源，父进程如何获知“子进程是否正常退出”、“是否被信号杀死？”、“`struct rusage`: 消耗了多少 CPU 时间？”
  - 因此，内核设计了两阶段退出
    - 退出（exit）：do_exit()
    - 收割（reap）：父进程调用 wait4()，进入内核 wait_task_zombie()->...->release_task()
- subreaper
  - 孤儿进程会由 PID 1 进程或其最近的 subreaper 祖先进行 reap
  - 通过 prctl(PR_SET_CHILD_SUBREAPER, ...) 可以将进程设置为 subrepaer，这样孤儿进程就会由这个 subreaper 进行 reap。在容器以及会话管理器（systemd --user）场景很重要，不用担心进程逃逸变成 PID 1 的子进程。相关代码：`find_new_reaper()`

```cpp
release_task()
  put_task_struct_rcu_user()

/* 最后会在这里释放 */
__put_task_struct_rcu_cb()->__put_task_struct()->free_task()->free_task_struct()

static void exit_notify(struct task_struct *tsk, int group_dead)
{
	bool autoreap;
	struct task_struct *p, *n;
	LIST_HEAD(dead);

	write_lock_irq(&tasklist_lock);
	forget_original_parent(tsk, &dead);

	if (group_dead)
		kill_orphaned_pgrp(tsk->group_leader, NULL);

	tsk->exit_state = EXIT_ZOMBIE;

	if (unlikely(tsk->ptrace)) {
		int sig = thread_group_leader(tsk) &&
				thread_group_empty(tsk) &&
				!ptrace_reparented(tsk) ?
			tsk->exit_signal : SIGCHLD;
		autoreap = do_notify_parent(tsk, sig);
	} else if (thread_group_leader(tsk)) {
                /* 如果进程组只剩当前这个主线程了，那就发送 tsk->exit_signal 给父进程，也就是 SIGCHLD。
                   如果进程组还有其他线程了，这里就不会通知父进程，那将来啥时候会通知呢？
                     答：在 release_task()->do_notify_parent() 里 */
		autoreap = thread_group_empty(tsk) &&
			do_notify_parent(tsk, tsk->exit_signal);
	} else {
                /* 线程组中的某个子线程 syscall exit() 了，直接 */
		autoreap = true;
		/* untraced sub-thread */
		do_notify_pidfd(tsk);
	}

	if (autoreap) {
		tsk->exit_state = EXIT_DEAD;
		list_add(&tsk->ptrace_entry, &dead);
	}

	/* mt-exec, de_thread() is waiting for group leader */
	if (unlikely(tsk->signal->notify_count < 0))
		wake_up_process(tsk->signal->group_exec_task);
	write_unlock_irq(&tasklist_lock);

	list_for_each_entry_safe(p, n, &dead, ptrace_entry) {
		list_del_init(&p->ptrace_entry);
		release_task(p);
	}
}

static inline bool thread_group_leader(struct task_struct *p)
{
        /* 为 -1 时，表示是某个线程组中的一员 */
	return p->exit_signal >= 0;
}
```

用 bpftrace 来看 exit_state 和 exit_signal

```bash
 sudo bpftrace -e 'kprobe:release_task /tid == 57043/ { @[kstack] = count(); }'

# 查看线程退出 do_exit()->do_task_dead() 时的 exit_state
 sudo bpftrace -e '
#include <linux/sched.h>
// 只匹配到某个线程
kprobe:do_task_dead /tid == 59667/ {
    $task = (struct task_struct *)curtask;
    printf("TID %d ENTERING do_task_dead(). Current exit_state: %d\n", pid, $task->exit_state);
}'

# 根据 bpftrace 的结果来看，即使主线程已经 syscall exit(0)，exit_state 状态为 EXIT_ZOMBIE，
# 子线程的 exit_signal 也仍然是 -1，也就是说 thread_group_leader() 为 false，子线程不会变为主线程
❯ sudo bpftrace -e '
#include <linux/sched.h>
// 这里过滤进程ID，线程组内的线程都会匹配到
kprobe:do_exit /pid == 69105/ {
    $task = (struct task_struct *)curtask;
    printf("TID %d ENTERING do_exit(). Current exit_signal: %d\n", pid, $task->exit_signal);
}'
Attaching 1 probe...
# 主线程 syscall exit(0)
# 17 的值是 SIGCHLD
TID 69105 ENTERING do_exit(). Current exit_signal: 17
# 子线程 syscall exit(0)
TID 69105 ENTERING do_exit(). Current exit_signal: -1
```

或者 crash vmlinux /proc/kcore 用 `task <PID>` 来查看。

##

- `ps -efL` 查看线程

##

get_task_struct() 增加 usage 计数，

用例：

write "<pid>,<vaddr_start>,<vaddr_end>" 到 /sys/kernel/debug/split_huge_pages 时，通过 pid 获取 task_struct 后，就会调用 get_task_struct() 增加 usage 计数，

## pid namespace

- [Pid Namespace 原理与源码分析 - 知乎](https://zhuanlan.zhihu.com/p/335171876)
- [Linux Namespace : PID - sparkdev - 博客园](https://www.cnblogs.com/sparkdev/p/9442208.html)
- [Pid Namespace 详解 - 泰晓科技](https://tinylab.org/pid-namespace/)
- https://chat.qwen.ai/c/9719e4bc-3da0-4919-8126-650fd122ea2b
- https://aistudio.google.com/prompts/1h80e8TCAkVm8vaaYikZlDSMpAj4qsW1v

---

- gettid() 和 getpid()，前者获取的是 task 粒度的 pid，后者是 task group 粒度的 tgid
- pid namespace，对容器技术很重要。
  - task_pid_nr() 和 task_pid_vnr() 的区别是什么？gettid() 是后者。

---

每个 PID Namespace 拥有独立的 PID 分配器；
同一进程在不同 Namespace 中可有不同的 PID；
PID=1 具有特殊语义：在该 Namespace 中承担 init 职责（收割孤儿、响应信号等）。

- `clone(fn, stack, CLONE_NEWPID | flags, arg)`: 创建一个新的子进程，并让这个子进程进入一个新的 PID Namespace。
- `unshare(CLONE_NEWPID)`: 让当前进程脱离它原来的 PID Namespace，进入一个新建的 PID Namespace。

新的 PID Namespace 里的 PID 1 是这个 Namespace 的“孤儿院院长”和“死神”。

- 收养孤儿 (Reaping): 在这个 Namespace 内部，如果一个进程变成了孤儿（其父进程先于它退出），它不会被宿主机的 init (PID 1) 接管，而是会被这个 Namespace 内部的 PID 1 接管。PID 1 必须负责 wait() 并 reap 这些孤儿，否则它们就会变成僵尸。一个设计良好的容器 init 程序（如 tini, dumb-init）的核心功能之一就是正确地处理这件事。
- 清理门户 (Terminating): 如果这个 Namespace 的 PID 1 进程自己退出了，内核会认为这个 Namespace 已经失去了存在的意义。于是，内核会向这个 Namespace 内部的所有其他进程发送 SIGKILL 信号，强制终结它们。这是一个确保 Namespace 不会泄露的清理机制。

---

数据结构

- 每个 task_struct 都包含一个 struct pid，存储了该 task 在每个 pid_namespace 层级中的 pid

```bash
unshare -p -m -u -n -i --fork \
  sh -c 'mount -t proc proc /proc && exec "$@"' -- bash
```

---
