# preempt_count 与 atomic context

```cpp
#define in_atomic()	(preempt_count() != 0)
```

atomic context 不会被抢占，也就是说，不会睡眠。
