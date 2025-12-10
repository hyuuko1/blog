- [linux 内核：一文读懂 wait_event_interruptible_timeout 机制 - 知乎](https://zhuanlan.zhihu.com/p/495783642)

wait_queue_head 和 wait_queue_entry

用法一

```cpp
/* 初始化 head */
DECLARE_WAITQUEUE(wait, current);

/* 初始化 entry ？*/
DEFINE_WAIT()

/* 唤醒 */
wake_up()->...->__wake_up_common()

```

用法二

```cpp
/* 初始化 head */
wait_queue_head_t wait;
init_waitqueue_head(&wait);
/* entry */
wait_event(&wait, some_condition());
wait_event_interruptible()

/* 加上 timeout 的版本 */
wait_event_timeout()
wait_event_interruptible_timeout()
```
