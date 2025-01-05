# Page Fault

## 参考

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

## 异常处理程序

### ARM 架构

如果没有命中 TLB 表项，内存管理单元将会查询内存中的页表，称为转换表遍历（translation table walk），分两种情况。

1. 如果虚拟地址的高 16 位全部是 1，说明是内核虚拟地址，应该查询内核的页表，从寄存器 TTBR1_EL1 取内核的页全局目录的物理地址。
2. 如果虚拟地址的高 16 位全部是 0，说明是用户虚拟地址，应该查询进程的页表，从寄存器 TTBR0_EL1 取进程的页全局目录的物理地址。

### x86 架构

```cpp
/* 不管是在用户态还是内核态触发 page fault 都是这个异常处理程序 */
asm_exc_page_fault()
  handle_page_fault()
    /* 不太可能是访问内核地址时 page fault ？ */
    if (unlikely(fault_in_kernel_space(address))) do_kern_addr_fault(regs, error_code, address);
    else do_user_addr_fault(regs, error_code, address);
      /* 如果发生在用户态，就加上这个 flag */
      if (user_mode(regs)) flags |= FAULT_FLAG_USER;
      vma = lock_vma_under_rcu(mm, address);
      fault = handle_mm_fault(vma, address, flags | FAULT_FLAG_VMA_LOCK, regs);
      /* 如果无需 retry，就 goto done 结束处理流程 */
      if (!(fault & VM_FAULT_RETRY)) goto done;
    retry:
      /* 重试 */
      fault = handle_mm_fault(vma, address, flags, regs);
```

## 用户空间页错误异常

从函数 `handle_mm_fault()` 开始的部分是所有处理器架构共用的部分，函数 handle_mm_fault 负责处理用户空间的页错误异常。用户空间页错误异常是指进程访问用户虚拟地址生成的页错误异常，分两种情况。

1. 进程在用户模式下访问用户虚拟地址，生成页错误异常。
2. 进程在内核模式下访问用户虚拟地址，生成页错误异常。进程通过系统调用进入内核模式，系统调用传入用户空间的缓冲区，进程在内核模式下访问用户空间的缓冲区。

```cpp
handle_mm_fault()
  if (unlikely(is_vm_hugetlb_page(vma))) hugetlb_fault(vma->vm_mm, vma, address, flags);
  else __handle_mm_fault(vma, address, flags); /* 普通页 */
    pgd = pgd_offset(mm, address);
    p4d_alloc(mm, pgd, address); /* pgd 是 NULL 时才会 alloc */
    vmf.pud = pud_alloc(mm, p4d, address);
    vmf.pmd = pmd_alloc(mm, vmf.pud, address);
    handle_pte_fault(&vmf);
      if (unlikely(pmd_none(*vmf->pmd))) vmf->pte = NULL;
      else
        vmf->pte = pte_offset_map_nolock()
        if (unlikely(!vmf->pte)) return 0;
        vmf->orig_pte = ptep_get_lockless(vmf->pte);
      /* 页表项不存在 */
      if (!vmf->pte) return do_pte_missing(vmf);
        /* 如果是私有匿名映射，则处理匿名页的缺页异常 */
        if (vma_is_anonymous(vmf->vma)) return do_anonymous_page(vmf);
        /* 如果是文件映射，或者共享匿名映射，则处理文件的缺页异常 */
        else return do_fault(vmf);
      /* 页表项存在，但是页不在物理内存中，说明页被换出到 swap 了 */
      if (!pte_present(vmf->orig_pte)) return do_swap_page(vmf);
      /* TODO 和 CONFIG_NUMA_BALANCING 有关 */
      if (pte_protnone(vmf->orig_pte) && vma_is_accessible(vmf->vma))
        return do_numa_page(vmf);
      /* 获取页表锁 //TODO 这个锁何时初始化的？ */
      spin_lock(vmf->ptl);
      /* 重新读取页表项的值，如果与获取锁前的值不同，说明其他 cpu 可能正在修改同一个页表项，
         那么当前处理器只需要等着使用其他处理器设置的页表项，没必要继续处理页错误异常 */
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
      if (ptep_set_access_flags(vmf->vma, vmf->address, vmf->pte, entry, vmf->flags & FAULT_FLAG_WRITE))
        update_mmu_cache_range(vmf, vmf->vma, vmf->address, vmf->pte, 1);
```

关于 `hugetlb_fault()`，详见 [hugetlb](./hugetlb.md)。

关于 ARM 架构的 dirty state 管理，详见 [The AArch64 Virtual Memory System Architecture](../arch/arm/virtual_memory.md)。

- [ ] 涉及到一些 thp 相关的，暂不讨论
- [ ] `FAULT_FLAG_UNSHARE` 是啥作用？
      [\[PATCH v4 15/17\] mm: support GUP-triggered unsharing of anonymous pages - David Hildenbrand](https://lore.kernel.org/all/20220428083441.37290-16-david@redhat.com/)

### do_anonymous_page 匿名页的缺页异常

### do_fault 文件页的缺页异常

#### do_read_fault 处理读文件页错误

#### do_cow_fault 处理写私有文件页错误

#### do_shared_fault 处理写共享文件页错误

### do_swap_page 页面换入

### do_wp_page 处理写时复制

## 内核模式页错误异常
