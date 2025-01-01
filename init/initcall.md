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

/* early_param() 宏定义的参数 setup_func 的执行过程  */
start_kernel->setup_arch->parse_early_param->parse_early_options
  do_early_param

/* __setup() 宏定义的参数 setup_func 的执行过程  */
start_kernel
  /* 发生在 memblock 初始化后。 */
  unknown_bootoption->obsolete_checksetup->setup_func()

/* 1 号进程 kernel_init */
start_kernel->rest_init->user_mode_thread(kernel_init)
kernel_init->kernel_init_freeable->do_basic_setup->do_initcalls
  /* 从 level0 开始执行 initcall */
  for (level = 0; level < ARRAY_SIZE(initcall_levels) - 1; level++)
    do_initcall_level(level, command_line);
      for (fn = initcall_levels[level]; fn < initcall_levels[level+1]; fn++)
        do_one_initcall(initcall_from_entry(fn));
```
