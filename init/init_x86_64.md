# Linux 内核初始化

- 🌟 [Booting | linux-insides](https://0xax.gitbook.io/linux-insides/summary/booting)
  - [引导 | linux-insides-zh](https://docs.hust.openatom.club/linux-insides-zh/booting)
- Linux 内核源代码情景分析，第 10 章

## setup.bin、进入 vmlinux.bin 之前、实模式

[Reset vector - Wikipedia](https://en.wikipedia.org/wiki/Reset_vector)

0xfffffff0

```cpp
/* arch/x86/boot/main.c 被编译进 setup.elf 了
   此时在实模式
*/
main
  detect_memory
    detect_memory_e820();
      ireg.ax  = 0xe820;
      intcall(0x15, &ireg, &oreg);
      boot_params.e820_entries = count;
    detect_memory_e801();
    detect_memory_88();
```

## 进入 vmlinux.bin、保护模式

```cpp
/* arch/x86/kernel/head_64.S */
startup_64
  startup_64_setup_gdt_idt
  __startup_64
  common_startup_64
    early_setup_idt
    initial_code 也即 x86_64_start_kernel
      x86_64_start_reservations->start_kernel


/* 启动其他 cpu */
do_boot_cpu
  if (apic->wakeup_secondary_cpu_64)
    /* 关键 */
    start_ip = real_mode_header->trampoline_start64;
  initial_code = (unsigned long)start_secondary;


trampoline_start64
  tr_start 其实就是下面设置的 trampoline_header->start 也就是 secondary_startup_64

/* 来看一下 trampoline_header->start 是怎么设置的 */
/* do_init_real_mode 用 early_initcall 宏声明过 */
do_init_real_mode->init_real_mode->setup_real_mode
  /* trampoline_header 这个指针，是在 arch/x86/realmode/rm/header.S 里定义为 trampoline_header 的，
    这里直接就修改了下面的 .space 8 这块区域
   */
  trampoline_header->start = (u64) secondary_startup_64;

/* arch/x86/realmode/rm/trampoline_64.S
   这里定义了 tr_start 变量 */
SYM_DATA_START(trampoline_header)
	SYM_DATA_LOCAL(tr_start,	.space 8)
	SYM_DATA(tr_efer,		.space 8)
	SYM_DATA(tr_cr4,		.space 4)
	SYM_DATA(tr_flags,		.space 4)
	SYM_DATA(tr_lock,		.space 4)
SYM_DATA_END(trampoline_header)
```

## [ ] CONFIG_PVH，不用 bzImage 直接用 vmlinux 是啥情况

使用 CONFIG_PVH 时，PVH 相关代码被编译进 vmlinux 了。

##

TODO boot_params.hdr.setup_data 会呈现给用户空间，/sys/kernel/debug/x86/boot_params/setup_data
create_setup_data_nodes
