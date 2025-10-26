# THP (Transparent Huge Page) 透明大页

- https://lwn.net/Kernel/Index/#Memory_management-Huge_pages
- [Transparent Hugepage Support (admin-guide) — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/mm/transhuge.html)
- [Transparent Hugepage Support — The Linux Kernel documentation](https://docs.kernel.org/mm/transhuge.html)
- [内存管理特性分析（十二）:大页(huge pages)技术分析 - 知乎](https://zhuanlan.zhihu.com/p/609457879)
- [透明大页的玄机 | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/nei-cun-guan-li/00-index/04-thp)
- [THP 和 mapcount 之间的恩恩怨怨 | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/nei-cun-guan-li/00-index/02-thp_mapcount)
- [Linux 中的 Memory Compaction [三] - THP - 知乎](https://zhuanlan.zhihu.com/p/117239320)
- [​Linux 内核透明巨型页支持](https://mp.weixin.qq.com/s/vrSHeFJL3yAbz5sVBlEyLA)
- [我们为什么要禁用 THP 丨 TiDB 应用实践 | PingCAP 平凯星辰](https://cn.pingcap.com/blog/why-should-we-disable-thp/)
- [Alibaba Cloud Linux 系统中与透明大页 THP 相关的性能调优方法 - Alibaba Cloud Linux - 阿里云](https://www.alibabacloud.com/help/zh/alinux/support/performance-tuning-method-related-to-transparent-large-page-thp-in)
- [避免 Linux 内存浪费：Facebook 开发新的 THP 收缩机制 - 知乎](https://zhuanlan.zhihu.com/p/611598334)
- [MySQL 是否适用大页 Hugepage 配置 - 知乎](https://zhuanlan.zhihu.com/p/9600760310)

## CONFIG

- CONFIG_ARCH_ENABLE_THP_MIGRATION
  默认开启的。允许迁移 THP。
  - [ ] 有好几个函数受此 config 影响，比如 `remove_migration_ptes()` 和 `try_to_migrate_one()`
        后面再学这个，放到 [page_migration](./page_migration.md) 里。
- CONFIG_READ_ONLY_THP_FOR_FS
- CONFIG_HAVE_ARCH_TRANSPARENT_HUGEPAGE_PUD

## 关键接口

梳理 THP 对外（内核中的其他模块）提供的一些关键接口的功能、使用场景。
梳理完后，再深入分析几个主要的使用场景。

---

mm/huge_mm.h mm/huge_memory.c

- sysfs
  - 有点多啊
  - [ ] defrag
- shrinker
  - huge_zero_page_shrinker
  - deferred_split_shrinker
- 启动参数
  - `transparent_hugepage=` always/madvise/never
  - `thp_anon=` always/madvise/inherit/never
- （待分类）
  - `thp_vma_allowable_orders()`
  - `thp_get_unmapped_area_vmflags()` 主要在 mmap 场景 `__get_unmapped_area()` 用到，详见 [mmap](./mmap.md)
  - `vma_thp_gfp_mask()` 返回 GFP 相关 flag，受 MADV_HUGEPAGE 和 transparent_hugepage_flags 影响。
  - `vmf_insert_folio_pud() vmf_insert_folio_pmd()` 在 `dev_dax_fault()` 等场景用的，不懂。
  - `madvise_free_huge_pmd()` 在 madvise(MADV_FREE) 时用到
  - `zap_huge_pmd()` 在 `unmap_page_range()` 时用的
  - `move_huge_pmd()` 在 `move_page_tables()` 时用的，不懂。
  - `change_huge_pud()` `change_huge_pmd()` 给 mprotect 用的
  - `move_pages_huge_pmd()` 给 uffd 用的
  - `vma_adjust_trans_huge()` split_vma() 等拆分 vma 时，如果 huge pmd 跨过了 vma 边界，就会用此函数 split huge pmd。
    - thp: avoid breaking huge pmd invariants in case of vma_adjust failures https://lore.kernel.org/all/201012152357.oBFNvvvi013658@imap1.linux-foundation.org/
  - `set_pmd_migration_entry()` `remove_migration_pmd()` 页面迁移场景
- 进程 clone 场景
  - `copy_huge_pmd()` 进程 clone 场景，为啥比 `copy_huge_pud()` 复杂这么多？
  - `copy_huge_pud()` 进程 clone 场景，如果是 is_cow_mapping() 则清除 pmd_t/pud_t 的 writable bit
- pagefault 场景
  - `do_huge_pmd_anonymous_page()` 匿名页 pagefault 场景
  - `do_huge_pmd_wp_page()` 进程 fork 后 CoW 场景。来自最初引入 THP 的一组 patch，v33 找不到了，有 v32 的 [[PATCH 30 of 66] transparent hugepage core - Andrea Arcangeli](https://lore.kernel.org/all/a7507af3a1dcae5c52a4.1288798085@v2.random/)
  - `do_huge_pmd_numa_page()` NUMA hinting page fault 时，不懂，[[PATCH 15/49] mm: numa: Create basic numa page hinting infrastructure - Mel Gorman](https://lore.kernel.org/all/1354875832-9700-16-git-send-email-mgorman@suse.de/)
  - `vmf_insert_pfn_pud() vmf_insert_pfn_pmd()` vfio mmap 时用的，设备直通，让虚拟机或用户态驱动能直接访问设备的 BAR 空间。
  - `huge_pud_set_accessed()` `huge_pmd_set_accessed()` 在不支持硬件标脏的硬件 pagefault 时，标记 Accessed 和 Dirty bit ？
- THP 拆分
  - `__split_huge_pmd_locked()` 涉及的场景有点多啊，主要是 munmap() 时 `__split_vma()` 的 thp pmd 页表拆分吧。
  - `__split_huge_pud_locked()`
  - `__folio_split()` large folio 拆分。
  - `deferred_split_folio()` 把 folio 放进 pgdat/memcg 粒度的 deferred_split_queue 队列
  - `__folio_unqueue_deferred_split()` 将 folio 从 deferred_split_queue 移除
  - `min_order_for_split()` 匿名页最小可以 split 成 0-order 的，而文件页（包括 shm）则由文件系统决定，例如 ext4_set_inode_mapping_order()
  - 非均匀拆分 THP [[PATCH v10 0/8] Buddy allocator like (or non-uniform) folio split - Zi Yan](https://lore.kernel.org/all/20250307174001.242794-1-ziy@nvidia.com/)
  - 回收 THP 时，无需 split MADV_FREE 的 lazyfree THP，提升效率 [[PATCH v8 0/3] Reclaim lazyfree THP without splitting - Lance Yang](https://lore.kernel.org/all/20240614015138.31461-1-ioworker0@gmail.com/)
- debugfs 接口 /sys/kernel/debug/split_huge_pages
  - [[PATCH v8 1/2] mm: huge_memory: a new debugfs interface for splitting THP tests.](https://lore.kernel.org/all/20210331235309.332292-1-zi.yan@sent.com/)
    - 原有功能：通过写入 `1` 来 split 系统中所有 THP，
    - 新增功能：通过写入 `<pid>,<vaddr_start>,<vaddr_end>` 仅 split 指定进程在特定虚拟地址范围内的 THP
  - [[PATCH v8 2/2] mm: huge_memory: debugfs for file-backed THP split. - Zi Yan](https://lore.kernel.org/all/20210331235309.332292-2-zi.yan@sent.com/)
    - 新增功能：通过写入 `<path>,<pgoff_start>,<pgoff_end>` 仅 split 指定文件特定范围内的 THP 文件页
  - 后面又有 patch，加上了两个参数 `,<new_order>,<in_folio_offset>`
    - in_folio_offset: folio 内部的偏移，单位同样是 4KB
  - 核心函数是 `__folio_split()`

---

mm/khugepaged.c 是从 mm/huge_memory.c 拆分出来的，khugepaged 线程相关

---

selftests

- tools/testing/selftests/mm/khugepaged.c
- tools/testing/selftests/mm/split_huge_page_test.c
  - 通过 /sys/kernel/debug/split_huge_pages 来测试 large folio split

## 场景

介绍主要的几个场景

### anon THP

先看这个 [pagefault](./pagefault.md)

```cpp
create_huge_pmd()
  /* 某些特殊的文件页（dax、vfio mmap） */
  if (vma->vm_ops->huge_fault) return vma->vm_ops->huge_fault(vmf, PMD_ORDER);
  /* 匿名页 */
  if (vma_is_anonymous(vma)) return do_huge_pmd_anonymous_page();
    ... /* 只读零页，懒得看。来看最关键的 */
    __do_huge_pmd_anonymous_page(vmf);
      /* 分配大页 */
      folio = vma_alloc_anon_folio_pmd(vma, vmf->address);
      /* 预留页表 */
      pgtable = pte_alloc_one(vma->vm_mm);
      /* pmd 页表的 struct page(也是 struct ptdesc) 上的页表锁 */
      vmf->ptl = pmd_lock(vma->vm_mm, vmf->pmd);
      /* 可能另一个线程并发弄好了已经 */
      if (unlikely(!pmd_none(*vmf->pmd))) goto unlock_release;
      /* TODO */
      pgtable_trans_huge_deposit(vma->vm_mm, vmf->pmd, pgtable);
      /* rmap、lru、设置页表项、更新 mmu、更新 stat */
      map_anon_folio_pmd(folio, vmf->pmd, vma, haddr);
	folio_add_new_anon_rmap()
	  /* _entire_mapcount starts at -1，这里相当于计数+1 */
	  atomic_set(&folio->_entire_mapcount, 0);
	  folio_set_large_mapcount(folio, mapcount=1, vma);
	    /* _large_mapcount starts at -1，这里相当于计数+1 */
	    atomic_set(&folio->_large_mapcount, mapcount - 1);
	    /* TODO mm_id 又 TM 是啥？ */
	    folio->_mm_id_mapcount[0] = mapcount - 1;
	    folio_set_mm_id(folio, 0, vma->vm_mm->mm_id);
	  atomic_set(&folio->_nr_pages_mapped, ENTIRELY_MAPPED);
	  SetPageAnonExclusive(&folio->page);
	...
      mm_inc_nr_ptes(vma->vm_mm);
      /* TODO */
      deferred_split_folio(folio, false);
      spin_unlock(vmf->ptl);
```

### tmpfs/shmem THP

- May 11, 2016 [Transparent huge pages in the page cache \[LWN.net\]](https://lwn.net/Articles/686690/)
- 2016-06-15 [\[PATCHv9-rebased2 00/37\] THP-enabled tmpfs/shmem using compound pages - Kirill A. Shutemov](https://lore.kernel.org/linux-mm/1466021202-61880-1-git-send-email-kirill.shutemov@linux.intel.com/)

```cpp
shmem_fault()->shmem_get_folio_gfp()->shmem_alloc_and_add_folio()
  suitable_orders = shmem_suitable_orders(inode, vmf, mapping, index, orders);
  order = highest_order(suitable_orders);
  folio = shmem_alloc_folio(gfp, order, info, index);
```

### pagecache THP

- [\[PATCH v2 0/8\] ext4: enable large folio for regular files - Zhang Yi](https://lore.kernel.org/all/20250512063319.3539411-1-yi.zhang@huaweicloud.com/)
  ext4

```cpp
__filemap_get_folio()
  unsigned int order = max(mapping_min_folio_order(mapping), FGF_GET_ORDER(fgp_flags));
  order = max(order, mapping_max_folio_order(mapping));
  folio = filemap_alloc_folio(alloc_gfp, order);
```

也就是说，只要 min_order 或 FGF_GET_ORDER(fgp_flags) 其中一个不为 0，那就是 large folio

- min_order
  - 对于 ext4，是 0
  - 对于 bdev，是 blksize 的 order
- FGF_GET_ORDER(fgp_flags) 由 fgf_set_order() 设置
  - btrfs 的 btrfs_buffered_write() 会用到
  - blkdev/xfs/fuse 调用到 iomap_file_buffered_write() 时会用到
  - ext4 调用到 write_begin_get_folio() 时

以 ext4 为例，在 write 系统调用时，

```cpp
sys_write()->...->ext4_file_write_iter()->ext4_buffered_write_iter()->generic_perform_write()
  write_begin():ext4_write_begin()
    folio = write_begin_get_folio(iocb, mapping, index, len);
      fgp_flags |= fgf_set_order(len);
      __filemap_get_folio()
	folio = filemap_alloc_folio(alloc_gfp, order);
	filemap_add_folio(mapping, folio, index, gfp)->__filemap_add_folio()
	  XA_STATE_ORDER(xas, &mapping->i_pages, index, folio_order(folio));
	  xas_store(&xas, folio); /* 放进 pagecache 了 */
  write_end():ext4_write_end()
    folio_put(folio);
```

然而，在 `filemap_fault()` 的路径上的都是 0-order，也就是说，目前 mmap+pagefault 产生的文件页不会是 THP （tmpfs/shmem 除外）。

### munmap() THP 时

munmap() THP 时需要拆分页表。

```cpp
__split_vma()->vma_adjust_trans_huge()
  split_huge_pmd_if_needed()->split_huge_pmd_address()->...->__split_huge_pmd_locked()
```

细节我放到后面讲吧

### 拆分大页的场景

- 内存回收时 `shrink_folio_list()` 在 swap 里 `folio_alloc_swap()` 分配失败，会 `split_folio_to_list()` 拆分大页，fallback 到 swap normal pages
- `migrate_pages_batch()` 时，有个 `try_split_folio()`

## 内部实现

### 数据结构

---

refcount、mapcount

```cpp

```

---

文件页支持的 min/max folio order

```cpp
struct address_space {
	...
	/* [16-25] 10 个 bit 用于存放支持的 folio order 的最小值和最大值。
	   可以推断出 folio order 的最大值是 2^5-1 = 31 */
	unsigned long		flags;
};

enum mapping_flags {
	/* Bits 16-25 are used for FOLIO_ORDER */
	AS_FOLIO_ORDER_BITS = 5,
	AS_FOLIO_ORDER_MIN = 16,
	/* flags[16-20] 存放 folio order min */
	AS_FOLIO_ORDER_MAX = AS_FOLIO_ORDER_MIN + AS_FOLIO_ORDER_BITS, /* 21 */
	/* flags[21-25] 存放 folio order max */
};
```

### 预留页表

### pud/pmd 页表拆分

```cpp
__split_huge_pmd_locked()
```

对文件页的处理很简单，直接 folio_put 了，为啥？

匿名页则是拆分成 pte

### THP split

分为两步：

1. 反向遍历，拆分所有 PMD map
2. 将 large folio 拆分为 small folios

### THP collapse: khugepaged 线程

定期扫描，合并普通页为大页

### THP deferrred split shrinker

### mTHP

[mthp](./mthp.md)

### refcount/mapcount 演进历史

## THP 演进历史

前面介绍的是截至文章更新时最新的内核实现。了解演进历史是很有必要的，能让我们理解 THP 的设计实现的缘由。

- 2010-11-03 [\[PATCH 00 of 66\] Transparent Hugepage Support #32 - Andrea Arcangeli](https://lore.kernel.org/all/patchbomb.1288798055@v2.random/)
  - 支持 anon THP
  - v33 https://lore.kernel.org/all/20101215051540.GP5638@random.random/
  - thp: transparent hugepage core
    - 处理 anon page fault 时，会预先分配好一个 PTE pagetable，存放到 mm_struct 粒度的链表里。现在这个函数叫做 `pgtable_trans_huge_deposit()`，与之相对应的函数是 `pgtable_trans_huge_withdraw()`，即存款和提款。
    - zap_huge_pmd() 时，会把这个预留的 pagetalbe 释放掉。
- 2014-11-11 [Transparent huge page reference counting \[LWN.net\]](https://lwn.net/Articles/619738/)
- 2015-10-06 [\[PATCHv12 00/37\] THP refcounting redesign - Kirill A. Shutemov](https://lore.kernel.org/linux-mm/1444145044-72349-1-git-send-email-kirill.shutemov@linux.intel.com/)
  - 新的 refcount mapcout 方案
    - anon THP 同时存在 PMD map 和 PTE map 时，会给所有 subpage 的 mapcount +1，这是为了保证 atomici page_remove_rmap()；并且，还会加上 PG_double_map bit，用于在 page_remove_rmap() 时判断是否同时存在 anon THP 的 PMD map 和 PTE map，如果同时存在，并且此时正在 remove 最后一个 PMD map 了，就需要把之前给所有 subpage +1 的 mapcount 给 -1 回来。
  - 支持 THP 的 PMD map 和 PTE map 共存
  - [PATCHv12 29/37] thp: implement split_huge_pmd() 新的 PMD 页表拆分实现
    - 会 page_ref_add(page, HPAGE_PMD_NR - 1); 这是因为多出了 512 个 PTE 映射，少了 1 个 PMD 映射，而对 subpage 进行 get_page() 实际上是对 head page 操作的。
  - [PATCHv12 30/37] thp: add option to setup migration entries during PMD split
    1. [PATCH RFC 和之前一样依赖于 compound_lock()](https://lore.kernel.org/linux-mm/1402329861-7037-7-git-send-email-kirill.shutemov@linux.intel.com/)
    2. [从 PATCHv2 开始](https://lore.kernel.org/linux-mm/1415198994-15252-19-git-send-email-kirill.shutemov@linux.intel.com/)，则是通过 migration PTE entries 来 stabilize page counts，也就是把页面放进 swapcache？和 try_to_unmap 差不多。
  - [PATCHv12 32/37] thp: reintroduce split_huge_page() 新的 THP 大页拆分实现
    1. 持有 anon_vma 锁，因为接下来我们要 rmap walk 了
    2. 检查是不是只有 caller 有额外的一个 refcount（也就是除了与 mapcount 一一对应的 refcount 以外，还有其他的 refcount，这也意味着现在页面被 pin 住了无法 migrate）
    3. `freeze_page()`：反向映射，拆分所有 PMD 页表。
       1. 遍历 anon_vma 区间树，找到所有映射了该大页的 PMD 虚拟地址
       2. `freeze_page_vma()` 拆分 PMD 页表。有可能已经 swap out 了，页表已经拆分了，这时则是处理这些 PTE swap entry。
    4. `__split_huge_page()` 复合页拆成普通页。
  - [PATCHv12 34/37] thp: introduce deferred_split_huge_page() 首次支持延迟拆分大页。如果某个 THP 已经不存在 PMD map，如果其中某些 subpage 不存在 PTE map，那么这些 subpage 也许是可以被释放的（之所以说“也许”，是因为还要考虑到 refcount），这就需要先 split THP 拆成小页，然后才能释放。这个 patch 做的事情：在 subpage 也许可以被释放时，把要拆分的 THP 放进一个队列，等内存回收时由 shrinker 来释放。
    - 在 page_remove_rmap() PMD page 时，如果这是最后一个 unmap 的大页，并且有 nr 个 subpage 没有 PTE map，说明这 nr 个 subpage 可以被释放，把 THP 放进队列。
    - 在 page_remove_rmap() subpage 时，如果 unmap 该 subpage 后，该 subpage 的 mapcount 为 -1，这说明，首先，已经没有 PageDoubleMap 带来的 1 个 mapcount，即，该 THP 没有 PMD map 了，另外，还说明该 subpage 没有 PTE map 了。于是把 THP 放进队列。
    - 定义了一个 deferred_split_shrinker
    - 在拆分 THP 时，如果该大页在队列内，则将其从队列中移除。
    - [ ] 对 mlocked THP 的处理
- 2016-03-07 [\[PATCHv2 0/4\] thp: simplify freeze_page() and unfreeze_page() - Kirill A. Shutemov](https://lore.kernel.org/linux-mm/1457351838-114702-1-git-send-email-kirill.shutemov@linux.intel.com/)
  - 在大页拆分时，使用通用的 rmap walker `try_to_unmap()`，简化了 `freeze_page()` 和 `unfreeze_page()`
    - try_to_unmap() 见 https://www.cnblogs.com/tolimit/p/5432674.html
  - TTU_SPLIT_HUGE_PMD 会让 try_to_unmap() 时先 split_huge_pmd_address() 拆分 PMD 页表。注意每次调用 try_to_unmap() 只会 unmap 一个 page 的所有反向映射，所以要调用 HPAGE_PMD_NR 次。
- 2016-05-11 [Transparent huge pages in the page cache \[LWN.net\]](https://lwn.net/Articles/686690/)
- 2016-06-15 [\[PATCHv9 00/32\] THP-enabled tmpfs/shmem using compound pages - Kirill A. Shutemov](https://lore.kernel.org/linux-mm/1465222029-45942-1-git-send-email-kirill.shutemov@linux.intel.com/)
  - 支持 tmpfs/shmem THP
  - [PATCHv9 05/32] rmap: support file thp
    - [ ] `page_add_file_rmap()` 对于 THP 会把每个 subpage 的 mapcount 都 +1。不理解为什不能和 `page_add_anon_rmap()` 一样，commit message 里说是后续再优化。
    - [ ] 不理解。PG_double_map 的优化对 file page 无效，这是因为 lifecycle 与 anon page 不同，file page 在没有 map 时还可以继续存在，随时再次被 map。
  - thp: support file pages in zap_huge_pmd()
  - thp: handle file pages in split_huge_pmd()
    - 只做了 unmap，没有像 anon page 那样分配页表去填 PTE，因为 file page 可以等到 page fault 时再去填 PTE 页表。不理解，如果填 PTE 页表，避免后续可能的 pagefault 不是很好吗？
  - thp: handle file COW faults
    - split huge pmd 然后在 pte level 处理。因为不清楚在 private file page CoW 场景分配 huge page 的收益如何，可能是过度设计。
  - thp: skip file huge pmd on copy_huge_pmd()
    - 典型场景：进程 clone。对于 file pages，可以不 alloc pagetable，不 copy pte/pmd，可以在 pagefault 时做。copy_huge_pmd() 的调用路径只有 copy_page_range()，后者会使得没有 vma->anon_vma 的跳过 copy pte/pmd。但是因为 private file mapping 是可以有 anon_vma 的，所以没有跳过，这里选择了让 copy_huge_pmd() 通过 vma->vm_ops 把这种情况检查出来，跳过 private file huge pmd 的 copy。
  - thp: file pages support for split_huge_page()
    - [ ] radix tree 意味着有 HPAGE_PMD_NR 个额外的 refcount？
    - thp 里的一些 subpages 可能超出了 i_size，将这些从 page cache 中移除。
    - 为了 lockless，先 `page_ref_freeze()` 把 head page 的 refcount 置 0 了，所以会在 `__split_huge_page()` 里 `page_ref_inc(head);` 补回来。
  - vmscan: split file huge pages before paging them out
  - filemap: prepare find and delete operations for huge pages
  - shmem: add huge pages support
- 2022-11-03 [\[PATCH 0/3\] mm,huge,rmap: unify and speed up compound mapcounts - Hugh Dickins](https://lore.kernel.org/linux-mm/5f52de70-975-e94f-f141-543765736181@google.com/)
  - 优化 compound mapcount
  - mm,thp,rmap: simplify compound page mapcount handling
- 2022-11-22 [\[PATCH v2 0/3\] mm,thp,rmap: rework the use of subpages_mapcount - Hugh Dickins](https://lore.kernel.org/linux-mm/a5849eca-22f1-3517-bf29-95d982242742@google.com/)
  - 在 Linus 的指导下，很快又修改了。
- 2024-04-09 [\[PATCH v1 00/18\] mm: mapcount for large folios + page_mapcount() cleanups - David Hildenbrand](https://lore.kernel.org/linux-mm/20240409192301.907377-1-david@redhat.com/)
  - 目前的实现。
- 2024-05-21 [Facing down mapcount madness \[LWN.net\]](https://lwn.net/Articles/974223/)
- 2023-07-10 [\[PATCH v4 0/9\] Create large folios in iomap buffered write path - Matthew Wilcox (Oracle)](https://lore.kernel.org/linux-fsdevel/20230710130253.3484695-1-willy@infradead.org/)
- 2024-04-15 [\[PATCH v3 0/4\] mm/filemap: optimize folio adding and splitting - Kairui Song](https://lore.kernel.org/all/20240415171857.19244-1-ryncsn@gmail.com/)
- 2024-02-26 [\[PATCH v5 0/8\] Split a folio to any lower order folios - Zi Yan](https://lore.kernel.org/linux-mm/20240226205534.1603748-1-zi.yan@sent.com/)
  - 支持将 folio split 到任意 low order
- 2025-03-07 [\[PATCH v10 0/8\] Buddy allocator like (or non-uniform) folio split - Zi Yan](https://lore.kernel.org/linux-mm/20250307174001.242794-1-ziy@nvidia.com/)
  - 支持 non-uniform folio split
- 2025-05-12 [\[PATCH v2 0/8\] ext4: enable large folio for regular files - Zhang Yi](https://lore.kernel.org/all/20250512063319.3539411-1-yi.zhang@huaweicloud.com/)
  - 为 ext4 regular files 支持 large folio
- 2017-05-15 🚧 [\[PATCH -mm -v11 0/5\] THP swap: Delay splitting THP during swapping out - Huang, Ying](https://lore.kernel.org/linux-mm/20170515112522.32457-1-ying.huang@intel.com/)

## huge_pmd 的增删改查

- zap_huge_pmd() 清除 pmd 页表项，移除反向映射。
  - 场景
    - unmap_vmas 时，
- split_huge_pmd()
  - 场景
    - `__split_vma()` 时
- copy_huge_pmd()
  - 场景
    - 进程 clone
- change_huge_pmd()

## TODO vma

- vma_adjust()
- unmap_vmas()
- ... 梳理各种 vma 操作。
