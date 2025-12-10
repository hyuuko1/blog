经常可以看到这种代码，

```cpp
DECLARE_STATIC_CALL(cond_resched, __cond_resched);

static __always_inline int _cond_resched(void)
{
	return static_call_mod(cond_resched)();
}
```

以及在系统启动时 `__sched_dynamic_update()` 启用/禁用各种 static call。
