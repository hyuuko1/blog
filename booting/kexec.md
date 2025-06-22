# kexec

主要的应用场景：

1. kdump (kexec on panic)
2. 云服务器厂商用这个做内核热升级。用户态的可能要 CRIU。
   还有 Kexec HandOver (KHO)、双 OS 热升级等方案。

## 参考

- [Kdump - The kexec-based Crash Dumping Solution — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/kdump/kdump.html)
- 🌟[【内核】kernel 热升级-1：kexec 机制 - \_hong - 博客园](https://www.cnblogs.com/lianyihong/p/17911774.html)
- [3.3.2 内核态调测工具：kdump&crash——kdump - 知乎](https://zhuanlan.zhihu.com/p/104292358)
- [3.3.3 内核态调测工具：kdump&crash——crash 解析 - 知乎](https://zhuanlan.zhihu.com/p/104384020)
- [Linux Kdump 机制详解](https://mp.weixin.qq.com/s/o89Z75IQgah75eW0_qHBtw)
- [Kexec - ArchWiki](https://wiki.archlinux.org/title/Kexec)
- [Kdump - ArchWiki](https://wiki.archlinux.org/title/Kdump)
- [yifengyou/crash: 内核 crash 分析](https://github.com/yifengyou/crash)
- 🌟<https://github.com/freelancer-leon/notes/blob/master/kernel/kexec.md>
- 🌟<https://github.com/freelancer-leon/notes/blob/master/kernel/kexec_x86.md>
- 🌟<https://github.com/freelancer-leon/notes/blob/master/kernel/kdump.md>
- [Booting Linux from Linux with kexec – The Good Penguin](https://www.thegoodpenguin.co.uk/blog/booting-linux-from-linux-with-kexec/)
- 🌟[kexec - A travel to the purgatory](https://eastrivervillage.com/kexec-tools-with-the-hidden-purgatory/)
- 🌟[玩转 OurBMC 第十二期：kdump 原理分析（下）](https://blog.csdn.net/OurBMC/article/details/143425496)

## 用户态工具 kexec-tools

- <https://github.com/horms/kexec-tools>

```bash
# -l 和 -p 都会通过 kexec_load() / kexec_file_load() 系统调用来加载内核，
# 但是加载的内核的用途不一样，-p 加载的是在 panic 时执行的 crash kernel
kexec -l /boot/vmlinux --append=root=/dev/hda1 --initrd=/boot/initrd
kexec -p /boot/vmlinux --append=root=/dev/hda1 --initrd=/boot/initrd

kexec -e
```

```cpp
/* kexec/kexec.c */
main()
  case OPT_LOAD:	/* -l */
    has_opt_load = 1;
    do_load = 1;
    do_exec = 0;
    do_shutdown = 0;
    break;
  case OPT_PANIC:	/* -p */
    do_load = 1;
    do_exec = 0;
    do_shutdown = 0;
    do_sync = 0;
    kexec_file_flags |= KEXEC_FILE_ON_CRASH;	/* 传给 kexec_file_load() 的参数 */
    kexec_flags = KEXEC_ON_CRASH;		/* 传给 kexec_load() 的参数 */
    break;
  case OPT_EXEC:	/* -e */
    do_load = 0;
    do_shutdown = 0;
    do_sync = 1;
    do_ifdown = 1;
    do_exec = 1;
    break;
```

## kexec_load() / kexec_file_load() 系统调用

kexec_file_load() 在内核内解析新内核，不像 kexec_load() 那样需要先在用户态解析新内核。

kexec 在内核加载阶段，于内存中创建了一张 控制表 control_code_page，用于存放重定向新内核地址的控制代码。这段控制代码名为

Kexec 会将用户传递的内核，initrd 等信息存储在 kexec_info 中的 segment 中，其中有很多代码都是在处理这部分内容。

```cpp
struct kimage {
        /* 一个数组 */
        kimage_entry_t *entry;

	struct kexec_segment segment[KEXEC_SEGMENT_MAX];

	/* 用户态传过来的内核、initrd文件内容，和命令行 */
	void *kernel_buf;
	unsigned long kernel_buf_len;
	void *initrd_buf;
	unsigned long initrd_buf_len;
	char *cmdline_buf;
	unsigned long cmdline_buf_len;
}

/* 用于函数调用时传递参数。 */
struct kexec_buf {
	struct kimage *image;
	/* 分配的内存。新内核的内容最终会拷贝到这里 */
	void *buffer;
	unsigned long bufsz;	/* void *buffer 的大小 */
	unsigned long mem;
	unsigned long memsz;	/* 加上 bss 后的大小 */
	unsigned long buf_align;
	unsigned long buf_min;	/* buffer 地址范围 */
	unsigned long buf_max;
	bool top_down;		/* 分配的方向 */
}

struct kexec_segment {
	union {
		void __user *buf;
		void *kbuf;
	};
	size_t bufsz;
	unsigned long mem;
	size_t memsz;
};

SYSCALL_DEFINE5(kexec_file_load, int kernel_fd, int initrd_fd,
		unsigned long cmdline_len, const char __user * cmdline_ptr,
		unsigned long flags)
  if (image_type == KEXEC_TYPE_CRASH)
    dest_image = &kexec_crash_image;
      if (kexec_crash_image)
        arch_kexec_unprotect_crashkres();
  else
    dest_image = &kexec_image;
  /* 释放上一次加载的 crash kernel */
  if (flags & KEXEC_FILE_ON_CRASH)
    kimage_free(xchg(&kexec_crash_image, NULL));

  /* 读取内核和 initrd，分配并初始化 struct kimage */
  kimage_file_alloc_init(&image, kernel_fd, initrd_fd, cmdline_ptr, cmdline_len, flags);
    struct kimage *image = do_kimage_alloc_init();
    if (kexec_on_panic)
      image->control_page = crashk_res.start;
    kimage_file_prepare_segments(image, kernel_fd, initrd_fd, cmdline_ptr, cmdline_len, flags);
      /* 读取内核文件内容到内核 */
      kernel_read_file_from_fd(kernel_fd, 0, &image->kernel_buf)
      /* 对新内核的 setup_header 做一些校验 */
      arch_kexec_kernel_image_probe()->bzImage64_probe()
      /* 读取 initrd 文件内容到内核 */
      kernel_read_file_from_fd(initrd_fd, 0, &image->initrd_buf)
      /* 拷贝来自用户态的内核启动参数 */
      image->cmdline_buf = memdup_user(cmdline_ptr, cmdline_len);
      /*  */
      image->image_loader_data = kexec_image_load_default()->bzImage64_load(image)
        /* 在 crash dump 的情况下，会追加 elfcorehdr=<addr> 启动参数，检查是否放得下。
           XXX 这里是否放个 image->type == KEXEC_TYPE_CRASH && 比较好？ */
        if (cmdline_len + MAX_ELFCOREHDR_STR_LEN > header->cmdline_size) return ERR_PTR(-EINVAL);
        /* TODO 如果是 crash kernel，没看懂 */
        if (image->type == KEXEC_TYPE_CRASH) crash_load_segments(image);
        /* 加载 purgatory */
        kexec_load_purgatory(image, &pbuf);
        /* 分配内存，用于放置 struct boot_params + cmdline + efi memmap +
        struct setup_data + struct efi_setup_data + struct setup_data + rng seed
        然后拷贝 setup header 到 boot_params 中 */
        params = kzalloc(kbuf.bufsz, GFP_KERNEL);
        memcpy(&params->hdr, (kernel + setup_hdr_offset), setup_header_size);
        kbuf.buffer = params;
        kexec_add_buffer(&kbuf); /* 把这块内存记录到 kexec_segment 数组中 */
        kbuf.buffer = kernel + kern16_size;
        kexec_add_buffer(&kbuf); /* 把 kernel 这块内存区域记录到 kexec_segment 数组中 */
        kbuf.buffer = initrd;
        kexec_add_buffer(&kbuf); /* 把 initrd 这块内存区域记录到 kexec_segment 数组中 */
        /* 在 boot_params 的 setup header 里设置好 initrd 的地址 */
        setup_initrd(params, initrd_load_addr, initrd_len);
        /* 设置好命令行，并在 boot_params 的 setup header 里设置好命令行地址 */
        setup_cmdline()
        /* 设置好进入 purgatory 时的寄存器 */
        ...
        /* 设置好 boot_params 里的一些内容 */
        setup_boot_parameters()
        /* 分配 loader specific data */
        kzalloc(sizeof(struct bzimage64_data), GFP_KERNEL);
    /* 分配 control_code_page */
    image->control_code_page = kimage_alloc_control_pages(image, get_order(KEXEC_CONTROL_PAGE_SIZE));
    /* 如果是 crash kernel 则 */
    image->swap_page = kimage_alloc_control_pages(image, 0);
  machine_kexec_prepare(image);
    /* 初始化恒等映射页表 */
    init_pgtable(image, __pa(control_page));
    /* 复制用于重定向新内核地址的控制代码到 control_code_page */
    void *control_page = page_address(image->control_code_page);
    __memcpy(control_page, __relocate_kernel_start, reloc_end - reloc_start);
  /* 遍历 kexec_segment 数组，分配页面，并拷贝，页面会记录在 kimage_entry_t 数组里。
  XXX 没搞懂拷贝时为什么要临时 kmap 一下 */
  for (i = 0; i < image->nr_segments; i++)
    kimage_load_segment(image, &image->segment[i]);
  kimage_terminate(image);
  kexec_post_load(image, flags);
  /* 释放内存 */
  kimage_file_post_load_cleanup(image);
  /* 最终完成修改，为啥要用 xchg？不是已经有锁保护了吗 */
  image = xchg(dest_image, image);
  arch_kexec_protect_crashkres();
  kexec_unlock();
  /* 释放上一次加载的 */
  kimage_free(image);
```

一些函数

```cpp
/* 将一个 buffer 添加到 struct kimage 的 struct kexec_segment segment[KEXEC_SEGMENT_MAX]; 数组内
 * 还会查找一个内存区域，地址会赋值给 kbuf->mem 这个地址应该是 kexec -e 时，会拷贝到这个地址？
 *
 */
int kexec_add_buffer(struct kexec_buf *kbuf)
```

### purgatory

Purgatory 是 Linux kexec 热重启机制中一个至关重要的安全组件。它在旧内核停止运行后、新内核开始执行前的短暂间隙运行，负责确保所有 CPU 处于安全状态、执行最低限度的硬件清理，并（可选但强烈推荐）验证新内核映像在内存中的完整性，防止加载后损坏导致启动失败或系统崩溃。它就像一个尽职的守门人，为新内核的顺利启动扫清障碍并进行最后的安全检查。

```bash
❯ file out/x86_64/arch/x86/purgatory/purgatory.ro
out/x86_64/arch/x86/purgatory/purgatory.ro: ELF 64-bit LSB relocatable, x86-64, version 1 (SYSV), not
❯ readelf -h out/x86_64/arch/x86/purgatory/purgatory.ro
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              REL (Relocatable file)
  Machine:                           Advanced Micro Devices X86-64
  Version:                           0x1
  Entry point address:               0x2a0
  Start of program headers:          0 (bytes into file)
  Start of section headers:          19392 (bytes into file)
  Flags:                             0x0
  Size of this header:               64 (bytes)
  Size of program headers:           0 (bytes)
  Number of program headers:         0
  Size of section headers:           64 (bytes)
  Number of section headers:         18
  Section header string table index: 16
```

purgatory 是一个 bootloader，在特定体系架构上编译 kexec 时，purgatory 会从相应特定体系的源码生成。它是一个 ELF 格式的 relocatable 文件

编译内核后，可以在一些 .cmd 文件里看到是如何编译出 purgatory.ro、kexec-purgatory.o 等文件的

```bash
savedcmd_arch/x86/purgatory/purgatory.ro := ld.lld -m elf_x86_64 --compress-debug-sections=zlib -z noexecstack  -r -e purgatory_start -z nodefaultlib arch/x86/purgatory/purgatory.o arch/x86/purgatory/stack.o arch/x86/purgatory/setup-x86_64.o arch/x86/purgatory/sha256.o arch/x86/purgatory/entry64.o arch/x86/purgatory/string.o -o arch/x86/purgatory/purgatory.ro
```

编译好的 purgatory.ro 被 .incbin 到 kexec-purgatory.S 里，

```asm
/* arch/x86/purgatory/kexec-purgatory.S */

	.section .rodata, "a"

	.align	8
kexec_purgatory:
	.globl	kexec_purgatory
	.incbin	"arch/x86/purgatory/purgatory.ro"
.Lkexec_purgatory_end:

	.align	8
kexec_purgatory_size:
	.globl	kexec_purgatory_size
	.quad	.Lkexec_purgatory_end - kexec_purgatory
```

kexec_load_purgatory() 加载 purgatory 并重定位。

```cpp
int kexec_load_purgatory(struct kimage *image, struct kexec_buf *kbuf)
  /* purgatory 是 elf 格式的，首部就是 elf header */
  pi->ehdr = (const Elf_Ehdr *)kexec_purgatory;
  /* 遍历 section headers，忽略不会被加载内存里的 SHF_ALLOC，
   * SHT_NOBITS 类型的是 bss section，计入 bss_sz，其他的计入 kbuf->bufsz
   * vzalloc 分配 kbuf->bufsz 大小的内存。内存地址 pi->purgatory_buf。
   * 记录进 kexec_segment 数组内。*/
  kexec_purgatory_setup_kbuf(pi, kbuf);
  /* 分配内存，拷贝 section headers（拷贝是因为要进行修改，而只读的不能修改）
   * 拷贝 section 内容到 pi->purgatory_buf */
  kexec_purgatory_setup_sechdrs(pi, kbuf);
  /* 修改 .rela.text 等 sections 中的重定位条目 */
  kexec_apply_relocations(image);
    arch_kexec_apply_relocations_add()
```

推荐阅读：[计算机系统篇之链接（5）：静态链接（下）——重定位](https://csstormq.github.io/blog/%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%B3%BB%E7%BB%9F%E7%AF%87%E4%B9%8B%E9%93%BE%E6%8E%A5%EF%BC%885%EF%BC%89%EF%BC%9A%E9%87%8D%E5%AE%9A%E4%BD%8D)

```bash
❯ readelf -r out/x86_64/arch/x86/purgatory/purgatory.ro | grep Relocation
Relocation section '.rela.text' at offset 0x32e8 contains 98 entries:
Relocation section '.rela__patchable_function_entries' at offset 0x3c18 contains 22 entries:
Relocation section '.rela.rodata' at offset 0x3e48 contains 2 entries:
```

### arch/x86/kernel/relocate_kernel_64.S

## reboot(LINUX_REBOOT_CMD_KEXEC) 系统调用

```cpp

```

## kexec on panic

crash kernel

## 其他

- CONFIG_CRASH_HOTPLUG
- [Kexec Handover Subsystem — The Linux Kernel documentation](https://docs.kernel.org/next/kho/index.html)
  https://www.phoronix.com/news/Kexec-HandOver-KHO-Linux-MM
  https://www.phoronix.com/news/Google-Live-Update-Orchestrator
  https://lore.kernel.org/lkml/20250320024011.2995837-1-pasha.tatashin@soleen.com/
  https://lore.kernel.org/all/20250320015551.2157511-1-changyuanl@google.com/
  Kexec HandOver（KHO）是一种机制，允许 Linux 在 kexec 过程中保留状态——包括任意属性以及内存位置。
  看起来挺牛的，
  - https://lpc.events/event/18/contributions/1732/attachments/1471/3116/lpc24-kexec-acpi_v3.pdf
    字节 STE 团队的工作，
  - https://lwn.net/Articles/924933/
    Parallel CPU bringup for x86_64
  - https://lpc.events/event/17/contributions/1512/
    https://lpc.events/event/17/contributions/1512/attachments/1256/2544/Fast%20Kernel%20Boot.pdf
  - https://kvmforum2022.sched.com/event/15jLX
    VF 不停
- [Preserving guest memory across kexec \[LWN.net\]](https://lwn.net/Articles/895453/)
- https://wangcong.org/2025-02-09-persistent-memory-in-linux-kexec.html
- https://github.com/oscomp/proj135-seamless-kernel-upgrade
  没想到字节也想搞双 OS 的热升级
  https://github.com/SmallPond/twinkernel
- http://www.popcornlinux.org/
  看起来贼 nb 啊
- https://github.com/kexecboot/kexecboot/wiki
- https://iliana.fyi/blog/kexec-systemd-boot-kernel-image/
- [\[PATCH 0/4\] faster kexec reboot - Albert Huang](https://lore.kernel.org/lkml/20220725083904.56552-1-huangjie.albert@bytedance.com/)
  不压缩 image
- [Seamless_Kernel_Update.pdf](https://archive.fosdem.org/2022/schedule/event/security_seamless_kernel/attachments/slides/5061/export/events/attachments/security_seamless_kernel/slides/5061/Seamless_Kernel_Update.pdf)
  CRIU checkpoint/restore apps
- [\[PATCH 1/2\] kexec: Add quick kexec support for kernel \[LWN.net\]](https://lwn.net/ml/linux-kernel/20200814055239.47348-1-sangyan@huawei.com/)
