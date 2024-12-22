```cpp
static initcall_entry_t *initcall_levels[] __initdata = {
	__initcall0_start,
	__initcall1_start,
	__initcall2_start,
	__initcall3_start,
	__initcall4_start,
	__initcall5_start,
	__initcall6_start,
	__initcall7_start,
	__initcall_end,
};

/* 1 号进程 kernel_init */
kernel_init->kernel_init_freeable->do_basic_setup->do_initcalls
  /* 从 level0 开始执行 initcall */
  for (level = 0; level < ARRAY_SIZE(initcall_levels) - 1; level++)
    do_initcall_level(level, command_line);
      for (fn = initcall_levels[level]; fn < initcall_levels[level+1]; fn++)
        do_one_initcall(initcall_from_entry(fn));
```
