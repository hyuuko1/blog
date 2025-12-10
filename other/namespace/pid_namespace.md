注意！pid_t 和 struct pid 并不是特指“进程 ID”，而是能表示 pid/tgid/pgid/sid 其中之一！

一个 task_struct 会关联多个 struct pid，这些 struct pid 分别记录了该 task 在不同的 pid namespace 下的 pid/tgid/pgid/sid。

- 每个 task 都有一个自己的 “对应于 PIDTYPE_PID 的 struct pid”
- 一个线程组内的 task 共享一个 “对应于 PIDTYPE_TGID 的 struct pid”，进程组内的 task、会话内的 task 同理，会共享。

双向联系

- 根据 task_struct 找 struct pid：只会对 task group leader 进行 init_task_pid()，这是因为线程组内的线程共享 struct signal_struct，所以只需要为 thread group 进行。
- 根据 struct pid 找 task_struct：只会对 task group leader 进行 attach_pid() 将 task_struct 放进链表。所以 do_each_pid_thread() 是先 do_each_pid_task() 找到每个 thread leader，再 for_each_thread() 找到每个 thread。

```cpp
struct task_struct {
	/* PID/PID hash table linkage. */
	struct pid			*thread_pid; /* 此 struct pid 对应 PIDTYPE_PID */
	struct hlist_node		pid_links[PIDTYPE_MAX]; /* 链表节点。链表头是 sturct pid 里的 tasks */

	struct signal_struct		*signal;
};
struct signal_struct {
	/* 链表头，链表节点是线程组内的每个线程 task_struct 的 thread_node 成员。相关函数 for_each_thread()  */
	struct list_head	thread_head;

	/* PID/PID hash table linkage. */
	struct pid *pids[PIDTYPE_MAX];  /* 多个 struct pid，分别记录了 PID, TGID, PGID, SID。
					   但是其实 pids[PIDTYPE_PID] 没被用到，实际上用的是 task_struct.thread_pid */
};

struct pid {
	/* lists of tasks that use this pid */
	/* 同一线程组/进程组/会话内的 task 会共享同一个 tgid/pgid/sid 类型的 struct pid，
	   因此这种情况下 struct pid 和 task 是一对多的关系，用链表。相关函数：attach_pid() */
	struct hlist_head tasks[PIDTYPE_MAX];
};

enum pid_type {
	PIDTYPE_PID,
	PIDTYPE_TGID,
	PIDTYPE_PGID,
	PIDTYPE_SID,
	PIDTYPE_MAX,
};

/* 获取某个 task 的 pid/tgid/pgid/sid 对应的 struct pid */
struct pid *get_task_pid(struct task_struct *task, enum pid_type type)
/* 获取当前 task 的 pid/tgid/pgid/sid */
pid_t pid_vnr(struct pid *pid)
```
