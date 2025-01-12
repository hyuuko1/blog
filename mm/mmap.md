# mmap

## 参考

- [从内核世界透视 mmap 内存映射的本质（原理篇） - 知乎](https://zhuanlan.zhihu.com/p/656876044)
- [从内核世界透视 mmap 内存映射的本质（源码实现篇） - 知乎](https://zhuanlan.zhihu.com/p/660439213)
- 《Linux 内核深度解析》3.4 内存映射。
  有很多本文未提及的代码细节。

## 概览

根据是否有 backing file，内存映射分为：

1. 文件映射：把文件的一个区间映射到进程的虚拟地址空间，数据源是存储设备上的文件。
2. 匿名映射：没有文件支持的内存映射，把物理内存映射到进程的虚拟地址空间，没有数据源。

根据修改是否对其他进程可见和是否传递到底层文件，内存映射分为：

1. 共享映射：修改数据时映射相同区域的其他进程可以看见，如果是文件支持的映射，修改会传递到底层文件。
2. 私有映射：第一次修改数据时会从数据源复制一个副本，然后修改副本，其他进程看不见，不影响数据源。

|          | 文件映射               | 匿名映射        |
| -------- | ---------------------- | --------------- |
| 共享映射 | 多个进程读写同一个文件 | 进程间共享内存  |
| 私有映射 | 动态链接库             | malloc() 的实现 |

通常把文件映射的物理页称为文件页，把匿名映射的物理页称为匿名页。

共享匿名映射的实现原理和文件映射相同，
共享匿名映射会创建名为“共享匿名映射”的文件，名字没有任何意义，创建两个共享匿名映射就会创建两个名为“/dev/zero”的文件，两个文件是独立的，毫无关系。

[struct vm_area_struct](./vma.md)

## 编程接口

### 系统调用

```cpp
/* 最后的两个参数 fd 和 offset 只有当创建文件映射的时候，才有意义 */
void *mmap(void addr, size_t length, int prot, int flags, int fd, off_t offset);

mremap()

int munmap(void addr, size_t length);

brk()

remap_file_pages()

/* 用来设置虚拟内存区域的访问权限 */
mprotect()

/* madvise()用来向内核提出内存使用的建议，应用程序告诉内核期望怎样使用指定的虚
   拟内存区域，以便内核可以选择合适的预读和缓存技术。 */
madvice()
```

mmap 的 flags

- `MAP_SHARED`：共享映射。
- `MAP_PRIVATE`：私有映射。
- `MAP_ANONYMOUS`：匿名映射。
- `MAP_FIXED`：固定映射，不要把参数 addr 解释为一个提示，映射的起始地址必须是参数 addr，必须是页长度的整数倍。
- `MAP_HUGETLB`：使用巨型页。
- `MAP_LOCKED`：把页锁在内存中。
- `MAP_NORESERVE`：不预留物理内存。
- `MAP_NONBLOCK`：不阻塞，和 MAP_POPULATE 联合使用才有意义，从 Linux 2.6.23 开始，该标志导致 MAP_POPULATE 什么都不做。
- `MAP_POPULATE`：填充页表，即分配并且映射到物理页。如果是文件映射，该标志导致预读文件。

madvice 的 advice

### 内核函数

```cpp
/* 把内存的物理页映射到进程的虚拟地址空间。用处：实现进程和内核共享内存 */
remap_pfn_range()

/* 把外设寄存器的物理地址映射到进程的虚拟地址空间。用处：进程可以直接访问外设寄存器 */
io_remap_pfn_page()
```

## mmap 主要流程

```cpp
/* offset 需 4K 对齐 */
__do_sys_mmap()->ksys_mmap_pgoff()
  struct file *file = NULL;
  if (!(flags & MAP_ANONYMOUS)) /* 如果是文件映射 */
    file = fget(fd);
    if (is_file_hugepages(file)) /* 文件可能是 hugetlbfs 里的，长度需要对齐 */
      len = ALIGN(len, huge_page_size(hstate_file(file)));
  else if (flags & MAP_HUGETLB) /* 匿名大页 */
    /* 长度对齐。 */
    struct hstate *hs = hstate_sizelog((flags >> MAP_HUGE_SHIFT) & MAP_HUGE_MASK);
    len = ALIGN(len, huge_page_size(hs));
    /* 在 hugetlbfs 文件系统中创建两个名为 anon_hugepage 的文件，文件名没有实际意义 */
    file = hugetlb_file_setup(HUGETLB_ANON_FILE)
  vm_mmap_pgoff()
    /* 以写者身份申请读写信号量 mm->mmap_lock */
    mmap_write_lock_killable(mm);
    /* 核心逻辑 */
    do_mmap();
    mmap_write_unlock(mm);
    /* 如果调用者要求把页锁定在内存中，或者要求填充页表并且允许阻塞，那么
       分配物理页，并且在页表中把虚拟页映射到物理页。
       常见的情况是：创建内存映射的时候不分配物理页，等到进程第一次访问虚拟页的时候，
       pagefault 异常处理程序分配物理页，在页表中把虚拟页映射到物理页 */
    if (populate) mm_populate(ret, populate);

/* mmap 的核心逻辑 */
do_mmap()
  /* 计算 vm_flags，把 PROT_ 和 MAP_ 开头的都转换成 VM_ 开头的 flag
     mm->def_flags 对于进程而言，默认是 VM_NOHUGEPAGE；对于内核线程默认是 0。
     VM_MAY_ 表示允许 mprotect 设置 READ/WRITE/EXEC */
  vm_flags |= calc_vm_prot_bits(prot, pkey) | calc_vm_flag_bits(file, flags) |
    mm->def_flags | VM_MAYREAD | VM_MAYWRITE | VM_MAYEXEC;
  /* 根据情况，用特定的函数，在进程的虚拟地址空间分配一个虚拟地址范围 */
  __get_unmapped_area()
    /* 如果是文件映射，或者匿名大页映射 */
    addr = file->f_op->get_unmapped_area()
    /* 如果是共享匿名映射。这个函数实际上就是 shmem_fs 里的 f_op->get_unmapped_area */
    addr = shmem_get_unmapped_area()
    /* 如果是私有匿名映射，并且启用了透明大页，且 len 2MB对齐 */
    addr = thp_get_unmapped_area_vmflags()
    /* 如果是私有匿名映射 */
    addr = mm_get_unmapped_area_vmflags()->mm_get_unmapped_area_vmflags()->arch_get_unmapped_area()
      if (flags & MAP_FIXED) return addr;
      /* 后面就是 find_vma() 啥的查找合适的地址范围 */
      ...
  /* 创建虚拟内存区域 */
  mmap_region()->__mmap_region()
    /* 检查进程申请的虚拟内存是否超过限制 */
    if (!may_expand_vm()) error = -ENOMEM; goto abort_munmap;
    /* 如果可以和已有的 vma 合并，如果可以合并，就不走后面的流程了 */
    vma = vma_merge_new_range(&vmg); if (vma) goto expanded;
    /* 如果不能合并，就创建一个新的 vma */
    vma = vm_area_alloc(mm);
    vma_set_range(vma, addr, end, pgoff);
    /* 对于文件映射，调用 file->f_op->mmap。如果 map 之后 vm_flags 变了，尝试重新合并，有可能成功。
       mmap 方法的主要功能是设置虚拟内存区域的虚拟内存操作集合 vm_ops，其中的 fault 很重要，
       第一次范围内虚拟页触发 pagefault 异常时，异常处理函数会调用 fault 方法把文件数据读到内存。
       很多文件系统把 mmap 设置为公共函数 generic_file_mmap，会把 fault 方法设置为 filemap_fault */
    vma->vm_file = get_file(file);
    mmap_file(file, vma);
    /* 对于共享的匿名映射，在内存文件系统 tmpfs 中创建名为 /dev/zero 的文件，并创建 file。
       vma 的 vm_file 会指向这个 file（明明不是文件页！），vm_ops 为 shmem_anon_vm_ops */
    shmem_zero_setup(vma);
    /* 对于私有的匿名映射，将 vma->vm_ops 设置为 NULL */
    vma_set_anonymous(vma);
    /* 添加到 mm 的 maple tree */
    vma_iter_store(&vmi, vma);
    mm->map_count++;
    /* 添加到 file 的 interval tree，如果有 file 的话 */
    vma_link_file(vma);
    /* 根据 vma->vm_flags 计算 vma-> vm_page_prot
       比如有些共享页想要 dirty tracking，就需要删除页保护可写位 */
    vma_set_page_prot(vma);
```

注意，这个流程里没有直接调用 `vma_link()`，和旧内核不同。

`__vm_enough_memory` 根据 overcommit 策略判断内存是否足够，详见 [oom](./oom.md)

## munmap 主要流程

```cpp
__vm_munmap()
  /* 以写者身份申请读写信号量 mm->mmap_lock */
  mmap_write_lock_killable(mm);
  do_vmi_munmap()
    vma = vma_find(vmi, end);
    do_vmi_align_munmap()
      struct vma_munmap_struct vms;
      /* 将 vma 收集起来 */
      vms_gather_munmap_vmas(&vms, &mas_detach);
      vms_complete_munmap_vmas(&vms, &mas_detach);
        /* 清除 pte */
        vms_clear_ptes(vms, mas_detach, !vms->unlock);
        /* 遍历 vma 进行移除。会让 rcu 来释放 */
      	mas_for_each(mas_detach, vma, ULONG_MAX) remove_vma(vma, false);
          vma_close(vma);
            vma->vm_ops->close(vma);
          vm_area_free(vma);
            call_rcu(&vma->vm_rcu, vm_area_free_rcu_cb);
  mmap_write_unlock(mm);

vm_area_free_rcu_cb()
  __vm_area_free()
    vma_lock_free(vma);
    kmem_cache_free(vm_area_cachep, vma);
```

`vms_clear_ptes()` 涉及到 tlb 模块，详见[tlb](./tlb.md)，还会涉及到释放页面到 buddy system 啥的。

## pagefault 流程

```cpp
do_anonymous_page()
  alloc_anon_folio->folio_prealloc->vma_alloc_folio->vma_alloc_folio_noprof()
    folio_alloc_mpol_noprof()->alloc_pages_mpol_noprof()->__alloc_pages_noprof()
      get_page_from_freelist()
```

## 其他

```cpp
/* 释放 mm_struct 时 */
exit_mmap()
  arch_exit_mmap->ldt_arch_exit_mmap->free_ldt_pgtables->free_pgd_range()->...
  unmap_vmas->unmap_single_vma->unmap_page_range() /* 这里和 __oom_reap_task_mm 那里是一样的 */
```
