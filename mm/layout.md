# Memory Layout

## 参考

- [一步一图带你深入理解 Linux 物理内存管理 - 知乎](https://zhuanlan.zhihu.com/p/585395024)
- [一步一图带你深入理解 Linux 虚拟内存管理 - 知乎](https://zhuanlan.zhihu.com/p/577035415)
- [一步一图带你构建 Linux 页表体系 —— 详解虚拟内存如何与物理内存进行映射 - 知乎](https://zhuanlan.zhihu.com/p/645063459)
- 《Linux 内核深度解析》3.2 虚拟地址空间布局

## x86_64 虚拟地址空间布局

4 级页表，`9 + 9 + 9 + 9 + 12 = 48` 共 `2^48 = 256TB` 的虚拟地址空间。

```c
========================================================================================================================
    Start addr    |   Offset   |     End addr     |  Size   | VM area description
========================================================================================================================
                  |            |                  |         |
 0000000000000000 |    0       | 00007fffffffffff |  128 TB | user-space virtual memory, different per mm
__________________|____________|__________________|_________|___________________________________________________________
                  |            |                  |         |
 0000800000000000 | +128    TB | ffff7fffffffffff | ~16M TB | ... huge, almost 64 bits wide hole of non-canonical
                  |            |                  |         |     virtual memory addresses up to the -128 TB
                  |            |                  |         |     starting offset of kernel mappings.
__________________|____________|__________________|_________|___________________________________________________________
                                                            |
                                                            | Kernel-space virtual memory, shared between all processes:
____________________________________________________________|___________________________________________________________
                  |            |                  |         |
 ffff800000000000 | -128    TB | ffff87ffffffffff |    8 TB | ... guard hole, also reserved for hypervisor
 ffff880000000000 | -120    TB | ffff887fffffffff |  0.5 TB | LDT remap for PTI
 ffff888000000000 | -119.5  TB | ffffc87fffffffff |   64 TB | direct mapping of all physical memory (page_offset_base)
 ffffc88000000000 |  -55.5  TB | ffffc8ffffffffff |  0.5 TB | ... unused hole
 ffffc90000000000 |  -55    TB | ffffe8ffffffffff |   32 TB | vmalloc/ioremap space (vmalloc_base)
 ffffe90000000000 |  -23    TB | ffffe9ffffffffff |    1 TB | ... unused hole
 ffffea0000000000 |  -22    TB | ffffeaffffffffff |    1 TB | virtual memory map (vmemmap_base)
 ffffeb0000000000 |  -21    TB | ffffebffffffffff |    1 TB | ... unused hole
 ffffec0000000000 |  -20    TB | fffffbffffffffff |   16 TB | KASAN shadow memory
__________________|____________|__________________|_________|____________________________________________________________
                                                            |
                                                            | Identical layout to the 56-bit one from here on:
____________________________________________________________|____________________________________________________________
                  |            |                  |         |
 fffffc0000000000 |   -4    TB | fffffdffffffffff |    2 TB | ... unused hole
                  |            |                  |         | vaddr_end for KASLR
 fffffe0000000000 |   -2    TB | fffffe7fffffffff |  0.5 TB | cpu_entry_area mapping
 fffffe8000000000 |   -1.5  TB | fffffeffffffffff |  0.5 TB | ... unused hole
 ffffff0000000000 |   -1    TB | ffffff7fffffffff |  0.5 TB | %esp fixup stacks
 ffffff8000000000 | -512    GB | ffffffeeffffffff |  444 GB | ... unused hole
 ffffffef00000000 |  -68    GB | fffffffeffffffff |   64 GB | EFI region mapping space
 ffffffff00000000 |   -4    GB | ffffffff7fffffff |    2 GB | ... unused hole
 ffffffff80000000 |   -2    GB | ffffffff9fffffff |  512 MB | kernel text mapping, mapped to physical address 0
 ffffffff80000000 |-2048    MB |                  |         |
 ffffffffa0000000 |-1536    MB | fffffffffeffffff | 1520 MB | module mapping space
 ffffffffff000000 |  -16    MB |                  |         |
    FIXADDR_START | ~-11    MB | ffffffffff5fffff | ~0.5 MB | kernel-internal fixmap range, variable size and offset
 ffffffffff600000 |  -10    MB | ffffffffff600fff |    4 kB | legacy vsyscall ABI
 ffffffffffe00000 |   -2    MB | ffffffffffffffff |    2 MB | ... unused hole
__________________|____________|__________________|_________|___________________________________________________________
```

## 用户虚拟地址空间布局

进程的用户虚拟地址空间包含以下区域。

- 代码段、数据段和未初始化数据段。
- 动态库的代码段、数据段和未初始化数据段。
- 存放动态生成的数据的堆。
- 存放局部变量和实现函数调用的栈。
- 存放在栈底部的环境变量和参数字符串。
- 把文件区间映射到虚拟地址空间的内存映射区域。

内存描述符 `struct mm_struct` 描述进程的用户虚拟地址空间

```cpp
struct task_struct {
	struct mm_struct *mm;
	struct mm_struct *active_mm;
}

struct mm_struct {
	atomic_t mm_count;
	atomic_t mm_users;	/* 如果两个进程同属一个线程组，那这里就是 2 */
}
```

每个进程的进程描述符的成员 mm 和 active_mm 都指向同一个内存描述符
内核线程没有用户虚拟地址空间，当内核线程没有运行的时候，进程描述符的成员 mm 和 active_mm 都是空指针；当内核线程运行的时候，active_mm 借用上一个进程的内存描述符，如果被借用的内存描述符所属的进程不属于线程组，那么内存描述符的成员 mm_users 不变，仍然是 1，成员 mm_count 加 1 变成 2。

为了使缓冲区溢出攻击更加困难，内核支持为内存映射区域、栈和堆选择随机的起始地址。进程是否使用虚拟地址空间随机化的功能，由以下两个因素共同决定。

1. 进程描述符的成员 personality（个性化）是否设置 ADDR_NO_RANDOMIZE。
2. 全局变量 randomize_va_space：0 表示关闭虚拟地址空间随机化，1 表示使内存映射区域和栈的起始地址随机化，2 表示使内存映射区域、栈和堆的起始地址随机化。可以通过文件“/proc/sys/kernel/randomize_va_space”修改。

## 内核地址空间布局

## 物理地址空间

8GB

```bash
$ cat /proc/iomem
00000000-00000fff : Reserved
00001000-0009fbff : System RAM
0009fc00-000fffff : Reserved
  000a0000-000bffff : PCI Bus 0000:00	# 128KB
  000c0000-000c0dff : Video ROM
  000f0000-000fffff : System ROM
00100000-7ffdcfff : System RAM		# 大约 2GB 的内存
  01000000-023fffff : Kernel code
  02400000-0358afff : Kernel rodata
  03600000-039510ff : Kernel data
  042b4000-047fffff : Kernel bss
7ffdd000-7fffffff : Reserved
80000000-afffffff : PCI Bus 0000:00	# 768MB
b0000000-bfffffff : PCI ECAM 0000 [bus 00-ff]	# 256MB
  b0000000-bfffffff : Reserved
    b0000000-bfffffff : pnp 00:04
c0000000-febfffff : PCI Bus 0000:00
  feb40000-feb7ffff : 0000:00:01.0	# 256KB 干啥用的？
  feb80000-febbffff : 0000:00:02.0	# 256KB
  febc0000-febc0fff : 0000:00:01.0	# 4KB 配置空间？
  febc1000-febc1fff : 0000:00:02.0	# 4KB
  febc2000-febc2fff : 0000:00:03.0	# 4KB
  febc3000-febc3fff : 0000:00:04.0	# 4KB
fec00000-fec003ff : IOAPIC 0
fed00000-fed003ff : HPET 0
  fed00000-fed003ff : PNP0103:00
fed1c000-fed1ffff : Reserved
  fed1f410-fed1f414 : iTCO_wdt.0.auto
fed90000-fed90fff : dmar0
feffc000-feffffff : Reserved
fffc0000-ffffffff : Reserved
# 4GB-10GB
100000000-27fffffff : System RAM	# 6GB 的内存
7000000000-77ffffffff : PCI Bus 0000:00	#
  7000000000-7000003fff : 0000:00:01.0
    7000000000-7000003fff : virtio-pci-modern
  7000004000-7000007fff : 0000:00:02.0
    7000004000-7000007fff : virtio-pci-modern
  7000008000-700000bfff : 0000:00:03.0
    7000008000-700000bfff : virtio-pci-modern
  700000c000-700000ffff : 0000:00:04.0
    700000c000-700000ffff : virtio-pci-modern
```
