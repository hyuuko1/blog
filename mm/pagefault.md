# Page Fault

## 参考

- [Linux page fault - 知乎](https://zhuanlan.zhihu.com/p/658583497)
- [Linux anonymous page fault - 知乎](https://zhuanlan.zhihu.com/p/669335977)
- [Linux file-backed page fault - 知乎](https://zhuanlan.zhihu.com/p/674910418)
- [一文聊透 Linux 缺页异常的处理 —— 图解 Page Faults - 知乎](https://zhuanlan.zhihu.com/p/673410655)
- 《Linux 内核深度解析》3.14 页错误异常处理

## 概览

页错误异常有几种情况：

1. 缺页异常：虚拟页没有映射到物理页
   1. 访问用户栈的时候，超出了当前用户栈的范围，需要扩大用户栈。
   2. 当进程申请虚拟内存区域的时候，通常没有分配物理页，进程第一次访问的时候触发页错误异常。
   3. 内存不足的时候，内核把进程的匿名页换出到交换区。
   4. 一个文件页被映射到进程的虚拟地址空间，内存不足的时候，内核回收这个文件页，在进程的页表中删除这个文件页的映射。
   5. 程序错误，访问没有分配给进程的虚拟内存区域。
      <br>前 4 种情况，如果页错误异常处理程序成功地把虚拟页映射到物理页，处理程序返回后，处理器重新执行触发异常的指令。
      <br>第 5 种情况，页错误异常处理程序将会发送 SIGSEGV 信号以杀死进程。
2. 没有访问权限
   1. 可能是软件有意造成的，典型的例子是写时复制（Copy on Write ， CoW）。
   2. 程序错误，例如试图写只读的代码段所在的物理页。页错误异常处理程序将会发送 SIGSEGV 信号以杀死进程。

页表项不存在的情况：

|          | 场景       | 读 (页表项不存在)   | 写 (页表项不存在)   |
| -------- | ---------- | ------------------- | ------------------- |
| 私有匿名 |            | `do_anonymous_page` | `do_anonymous_page` |
| 共享匿名 |            | `do_read_fault`     | `do_shared_fault`   |
| 共享文件 |            | `do_read_fault`     | `do_shared_fault`   |
| 私有文件 | 动态链接库 | `do_read_fault`     | `do_cow_fault`      |

注意：私有文件映射页在写复制后，成了进程的私有匿名页，和文件脱离关系，不会 write back。

页表项存在的情况：

- 如果页不在物理内存中，则说明在 swap 中，`do_swap_page`。
- 如果页在物理内存中，而且 pte 里没写权限（vmf->flags 里由），则说明是 fork 的私有页 CoW `do_wp_page`。

## 异常处理程序

### ARM 架构

如果没有命中 TLB 表项，内存管理单元将会查询内存中的页表，称为转换表遍历（translation table walk），分两种情况。

1. 如果虚拟地址的高 16 位全部是 1，说明是内核虚拟地址，应该查询内核的页表，从寄存器 TTBR1_EL1 取内核的页全局目录的物理地址。
2. 如果虚拟地址的高 16 位全部是 0，说明是用户虚拟地址，应该查询进程的页表，从寄存器 TTBR0_EL1 取进程的页全局目录的物理地址。

### x86 架构

用的居然是中断门，而非陷阱门！！
因此发生 page fault 时，CPU 会自动清 RFLAGS.IF 禁本地中断。

从 git history 中找不出原因，DeepSeek 给出的解释是：
Page Fault 的处理可能涉及修改页表、分配物理内存、调整进程地址空间等操作。这些操作需要保证原子性，避免被其他中断（如时钟中断、设备中断）打断，否则可能导致数据竞争或状态不一致。
若处理程序需要睡眠（如触发 I/O 操作或等待内存分配），内核仍可显式调用 `local_irq_enable()` 临时开启中断。
例如，处理用户态缺页时，可能因等待磁盘 I/O（如换页）而允许中断。

在[这个 patch](https://lore.kernel.org/all/20240125173457.1281880-1-torvalds@linux-foundation.org/) 后，在 `do_user_addr_fault()` 处理访问用户虚拟地址异常时，会 `local_irq_enable()` 开启中断。在此之前是这样的：

```cpp
/* 如果是用户态访问用户虚拟地址异常，开中断 */
if (user_mode(regs)) {
	local_irq_enable();
	flags |= FAULT_FLAG_USER;
} else {
	/* 如果是内核态访问用户虚拟地址异常。如果产生异常时是开中断的，则开 */
	if (regs->flags & X86_EFLAGS_IF)
		local_irq_enable();
}
```

我的想法是：直接判断是否产生异常时是开中断的不就行了吗？用户态肯定开着中断的啊。
但是，我又发现了这个 commit: https://github.com/torvalds/linux/commit/891cffbd6bcba26409869c19c07ecd4bfc0c2460
难道用户态也可以关中断？是的！在 Linux 5.5 之前可以用 [iopl(2)](https://man7.org/linux/man-pages/man2/iopl.2.html) 关闭中断！

```cpp
static const __initconst struct idt_data early_pf_idts[] = {
	/* INTG: Interrupt gate */
	INTG(X86_TRAP_PF,		asm_exc_page_fault),
};

/* 不管是在用户态还是内核态触发 page fault 都是这个异常处理程序 */
asm_exc_page_fault()
  handle_page_fault()
    /* 访问内核虚拟地址时 page fault 这种情况非常少见 */
    if (unlikely(fault_in_kernel_space(address)))
      do_kern_addr_fault(regs, error_code, address);
    else
      do_user_addr_fault(regs, error_code, address);
        local_irq_enable();
        /* 如果发生在用户态，就加上这个 flag */
        if (user_mode(regs)) flags |= FAULT_FLAG_USER;
        vma = lock_vma_under_rcu(mm, address);
        /* 如果是权限错误 */
        if (unlikely(access_error(error_code, vma)))
          bad_area_access_error(regs, error_code, address, NULL, vma);
	/* 处理 */
        fault = handle_mm_fault(vma, address, flags | FAULT_FLAG_VMA_LOCK, regs);
        /* 如果无需 retry，就 goto done 结束处理流程 */
        if (!(fault & VM_FAULT_RETRY)) goto done;
        retry:
          /* 重试 */
          fault = handle_mm_fault(vma, address, flags, regs);
      local_irq_disable();
```

## 用户空间页错误异常

从函数 `handle_mm_fault()` 开始的部分是所有处理器架构共用的部分，负责处理用户空间的页错误异常。用户空间页错误异常是指进程访问用户虚拟地址生成的页错误异常，分两种情况。

1. 进程在用户模式下访问用户虚拟地址，生成页错误异常。
2. 进程在内核模式下访问用户虚拟地址，生成页错误异常。进程通过系统调用进入内核模式，系统调用传入用户空间的缓冲区，进程在内核模式下访问用户空间的缓冲区。

简述 `handle_mm_fault()` 流程：

1. 如果 pgd p4d pud 页表不存在，则创建。
2. 如果 pud 页表项空的，则尝试透明大页。成功则返回。
3. 如果 pud 页表项不是空的，并且是透明大页，要么是因为 CoW，要么是因为要软件标记 access dirty 位。返回。
   XXX 没有判断 swap 的情况吗？默认 pud huge page 不支持 swap？
4. 如果 pmd 页表不存在，则创建。
5. 如果 pmd 页表项空的，则尝试透明大页。成功则返回。
6. 如果 pmd 页表项不是空的，...
7. 最后，`handle_pte_fault()`
   1. pte 页表项不存在的情况
      1. 私有匿名映射的情况
      2. 文件或共享匿名映射的情况
   2. pte 页表项存在，但是页不在物理内存中
   3. pte 页表项存在，页也在物理内存中，可能的原因有：
      1. 其他 cpu 在修改同一个页表项
      2. 没写权限，进行 CoW。//XXX 注意这和 `do_user_addr_fault()->bad_area_nosemaphore()  和 bad_area_access_error()` 不一样。后者要么是没找到 vma，要么 vma->vm_flags 里没 VM_WRITE，用户态程序没权限访问。
      3. 有写权限，产生异常的原因可能是因为没启用硬件标脏，需要软件来。

```cpp
handle_mm_fault()
  /* 大页 */
  if (unlikely(is_vm_hugetlb_page(vma))) hugetlb_fault(vma->vm_mm, vma, address, flags);
  else __handle_mm_fault(vma, address, flags); /* 普通页 */
    pgd = pgd_offset(mm, address);
    p4d_alloc(mm, pgd, address); /* pgd 是 NULL 时才会 alloc */
    vmf.pud = pud_alloc(mm, p4d, address);
    /* 尝试 pud huge page fault */
    ...
    vmf.pmd = pmd_alloc(mm, vmf.pud, address);
    /* 尝试 pmd huge page fault */
    ...
    handle_pte_fault(&vmf);
      if (unlikely(pmd_none(*vmf->pmd))) vmf->pte = NULL;
      else
        /* 这里会让 vmf->ptl 指向页表锁 */
        vmf->pte = pte_offset_map_nolock()
          *ptlp = pte_lockptr(mm, pmdvalp);
        if (unlikely(!vmf->pte)) return 0;
        vmf->orig_pte = ptep_get_lockless(vmf->pte);
      /* pte 页表项不存在 */
      if (!vmf->pte) do_pte_missing(vmf);
        /* 如果是私有匿名映射，则处理匿名页的缺页异常 */
        if (vma_is_anonymous(vmf->vma))
	  return do_anonymous_page(vmf);
        /* 如果是文件映射，或者共享匿名映射，则处理文件的缺页异常 */
        else do_fault(vmf);
          if (!vma->vm_ops->fault)
          else if (!(vmf->flags & FAULT_FLAG_WRITE))
            do_read_fault(vmf);
          else if (!(vma->vm_flags & VM_SHARED))
            do_cow_fault(vmf);
          else
            do_shared_fault(vmf);
      /* 页表项存在，但是页不在物理内存中，说明页被换出到 swap 了 */
      if (!pte_present(vmf->orig_pte)) return do_swap_page(vmf);
      /* TODO 和 CONFIG_NUMA_BALANCING 有关 */
      if (pte_protnone(vmf->orig_pte) && vma_is_accessible(vmf->vma))
        return do_numa_page(vmf);
      /* 如果以上的都不是，那么，页表项存在，页也在物理内存中 */
      /* 获取页表锁 */
      spin_lock(vmf->ptl);
      /* 重新读取页表项的值，如果与获取锁前的值不同，说明其他 cpu 可能正在修改同一个页表项，
         那么当前处理器只需要等着使用其他处理器设置的页表项，这里没必要继续处理了 */
      if (unlikely(!pte_same(ptep_get(vmf->pte), entry)))
        update_mmu_tlb(vmf->vma, vmf->address, vmf->pte);
        goto unlock;
      /* 如果是由写操作造成的，或者是另外一种情况造成的
         TODO 另外一种情况是在 __get_user_pages->faultin_page 里设置了 FAULT_FLAG_UNSHARE */
      if (vmf->flags & (FAULT_FLAG_WRITE|FAULT_FLAG_UNSHARE))
        /* 如果没有写权限，则进行 CoW */
        if (!pte_write(entry)) return do_wp_page(vmf);
        /* 对于 ARM 架构，如果未启用硬件管理 dirty state，那么 writable-clean 的描述符会造成
           Permission fault，由 Linux 管理 dirty state */
        else if (likely(vmf->flags & FAULT_FLAG_WRITE)) entry = pte_mkdirty(entry);
      /* 置上 Access flag */
      entry = pte_mkyoung(entry);
      /* 如果 pte 和之前的相比有变化，则更新页表里的页表项，并进行 TLB invalid */
      if (ptep_set_access_flags(vmf->vma, vmf->address, vmf->pte, entry, vmf->flags & FAULT_FLAG_WRITE))
        update_mmu_cache_range(vmf, vmf->vma, vmf->address, vmf->pte, 1);
```

pgd p4d pud pmd pte page 对应的 `struct page` 的内容其实是 64byte 的 `struct ptdesc`。
如果启用了 `CONFIG_SPLIT_PTE_PTLOCKS`，那么 `pte_lockptr()` 返回的就是细粒度的 ptdesc 里的 ptl，否则就是粗粒度的 mm_struct 里的 page_table_lock。

关于 `hugetlb_fault()`，详见 [hugetlb](./hugetlb.md)。
关于为什么共享匿名映射为什么 `vma_is_anonymous()` 是 false，为什么和文件映射一样用 `do_fault()` 处理，见 [mmap](./mmap.md)。

关于 ARM 架构的 dirty state 管理，详见 [The AArch64 Virtual Memory System Architecture](../arch/arm/virtual_memory.md)。

- [ ] 涉及到一些 thp 相关的，暂不讨论
  - [ ] Support for transparent PUD pages for DAX files https://lwn.net/Articles/674185/
- [ ] `FAULT_FLAG_UNSHARE` 是啥作用？
      [\[PATCH v4 15/17\] mm: support GUP-triggered unsharing of anonymous pages - David Hildenbrand](https://lore.kernel.org/all/20220428083441.37290-16-david@redhat.com/)
- [ ] devmap 是什么？

### do_anonymous_page (私有)匿名页的缺页异常

`vma_is_anonymous()` 函数认为 `vma->vm_ops` 为 NULL 的是匿名页。

共享匿名映射的页面，其 vm_ops 不是 NULL，是 `shmem_anon_vm_ops`，因此不被视作匿名页，而是文件页。详见 [mmap](./mmap.md)
TODO 为啥这么设计？我的理解：linux 把这一块共享的资源抽象为一个文件？多个进程共享这个内存，就相当于是共享这个文件？

```cpp
do_anonymous_page()
  /* 如果是 vm_ops 为 NULL 的共享映射，说明有问题 */
  if (vma->vm_flags & VM_SHARED) return VM_FAULT_SIGBUS;
  /* 如果 pte 页表不存在，则分配，并初始化 ptdesc */
  pte_alloc(vma->vm_mm, vmf->pmd);
  /* 如果不是写操作导致的 fault，则使用 zero page */
  if (!(vmf->flags & FAULT_FLAG_WRITE))
    /* 映射到专用的零页，并置上软件定义的 PTE_SPECIAL flag */
    entry = pte_mkspecial(pfn_pte(my_zero_pfn(vmf->address)));
    /* 找到 pte 页表项，并上锁 */
    vmf->pte = pte_offset_map_lock();
    /* ___pte_offset_map 返回 NULL，说明获取 pte 失败，比如因为是大页或 devmap，
       会 gotounlock 返回 0，这是因为有可能同时另一个线程发生了 huge pmd fault 并处理了？
       XXX 会有这种情况吗？看看 git history */
    if (!vmf->pte) goto unlock;
    /* 在我们获取锁前，有可能另一个线程正在处理相同 page 的异常 */
    if (vmf_pte_changed(vmf)) update_mmu_tlb(); goto unlock;
    /* 去更新页表 */
    goto setpte;
  /* TODO 匿名页的反向映射 */
  vmf_anon_prepare(vmf);
  /* 分配我们自己的私有页，会优先从 highmem 分配，并初始化为 0，
     TODO 这里可能因为 thp 一下子分配多个页面？
     https://lore.kernel.org/all/20231207161211.2374093-1-ryan.roberts@arm.com/ */
  alloc_anon_folio(vmf);
    /* TODO 涉及一堆 thp 相关的 */
    ...
    folio_prealloc(, need_zero=true)
  /* 给 struct page 的 ->flags 置上 PG_uptodate，表示物理页包含有效的数据 */
  __folio_mark_uptodate(folio);
  /* 生成页表项 */
  entry = mk_pte(&folio->page, vma->vm_page_prot);
  /* 除了不支持硬件设置 Access bit 的 MIPS 架构以外，其他架构的这个啥也没做。
     详见 https://lore.kernel.org/all/1590546320-21814-4-git-send-email-maobibo@loongson.cn/
     XXX 有些 arm cpu 也不支持硬件设置 Access bit 吧，这里是不是 pte_mkyoung 更好些，可以省去一次 page fault ? */
  entry = pte_sw_mkyoung(entry);
  /* 对于某些不支持硬件设置 dirty bit 的 ARM 机器，这里 pte_mkdirty 标记脏页，
     使得 entry 为 Writable-dirty，这样下次 write 时就不会 Permission fault */
  if (vma->vm_flags & VM_WRITE)
    entry = pte_mkwrite(pte_mkdirty(entry), vma);
  /* 找到 pte 页表项，并上锁 */
  vmf->pte = pte_offset_map_lock();
  if (!vmf->pte) goto release;
  /* 建立起匿名页的反向映射 */
  folio_add_new_anon_rmap(folio, vma, addr, RMAP_EXCLUSIVE);
  /* 放到 LRU 链表中 */
  folio_add_lru_vma(folio, vma);
setpte:
  /* 设置页表项 */
  set_ptes(vma->vm_mm, addr, vmf->pte, entry, nr_pages);
  /* 更新 TLB */
  update_mmu_cache_range(vmf, vma, addr, vmf->pte, nr_pages);
```

- [ ] userfaultfd 相关的部分

### do_fault 文件页的缺页异常

哪些情况会触发文件页的缺页异常呢？

1. 启动用户态程序的时候，代码段和数据段创建私有的文件映射，映射到进程的虚拟地址空间，第一次访问的时候触发文件页的缺页异常。
2. 进程使用 mmap 创建文件映射，把文件的一个区间映射到进程的虚拟地址空间，第一次访问的时候触发文件页的缺页异常。
3. 进程 `mmap(,,MAP_SHARED|MAP_ANONYMOUS)` 创建共享匿名映射，第一次访问时触发缺页异常

函数 `do_fault()` 处理文件页和共享匿名页的缺页异常

#### do_read_fault 处理读文件页错误

文件页内容不在 page cache 里，

```cpp

```

#### do_cow_fault 处理写私有文件页错误

```cpp

```

#### do_shared_fault 处理写共享文件/匿名页错误

```cpp

```

### do_swap_page 页面换入

```cpp

```

### do_wp_page 处理写时复制

```cpp

```

## 内核模式页错误异常

```bash
@[
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_trampoline_6442466157+67
    __do_fault+5
    do_fault+279
    __handle_mm_fault+1986
    handle_mm_fault+226
    do_user_addr_fault+349
    exc_page_fault+129
    asm_exc_page_fault+38
    _copy_to_iter+199
    copy_page_to_iter+140
    filemap_read+478
    vfs_read+665
    __x64_sys_pread64+152
    do_syscall_64+130
    entry_SYSCALL_64_after_hwframe+118
]: 1065
@[
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_trampoline_6442466157+67
    __do_fault+5
    do_fault+279
    __handle_mm_fault+1986
    handle_mm_fault+226
    do_user_addr_fault+349
    exc_page_fault+129
    asm_exc_page_fault+38
    _copy_to_iter+199
    copy_page_to_iter+140
    shmem_file_read_iter+264
    vfs_read+665
    __x64_sys_pread64+152
    do_syscall_64+130
    entry_SYSCALL_64_after_hwframe+118
]: 1362
@[
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+12846
    bpf_trampoline_6442466157+67
    __do_fault+5
    do_fault+279
    __handle_mm_fault+1986
    handle_mm_fault+226
    do_user_addr_fault+535
    exc_page_fault+129
    asm_exc_page_fault+38
]: 18173
```

[详解 Linux 内核之脏页跟踪-良许 Linux 教程网](https://www.lxlinux.net/8943.html)
[linux 那些事之 zero page【转】 - Sky&amp;Zhang - 博客园](https://www.cnblogs.com/sky-heaven/p/16621085.html)
[RISC-V 缺页异常处理程序分析（2）：handle_pte_fault() 和 do_anonymous_page() - 泰晓科技](https://tinylab.org/riscv-page-fault-part2/)
[ARM Linux 如何模拟 X86 PTE 中的 Present Young 和 Dirty 标志位\_arm 怎么模拟 dirty-CSDN 博客](https://blog.csdn.net/zf1575192187/article/details/105207086)
