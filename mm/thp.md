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

## PATCH / LWN.net

待补充

- 2010-11-03 [\[PATCH 00 of 66\] Transparent Hugepage Support #32 - Andrea Arcangeli](https://lore.kernel.org/all/patchbomb.1288798055@v2.random/)
  - 支持 THP
  - v33 https://lore.kernel.org/all/20101215051540.GP5638@random.random/
- November 11, 2014 [Transparent huge page reference counting \[LWN.net\]](https://lwn.net/Articles/619738/)
- 2015-10-06 [\[PATCHv12 00/37\] THP refcounting redesign - Kirill A. Shutemov](https://lore.kernel.org/linux-mm/1444145044-72349-1-git-send-email-kirill.shutemov@linux.intel.com/)
  - 新的 refcount mapcout 方案
  - 支持 THP 的 PMD map 和 PTE map 共存
- 2016-06-15 [\[PATCHv9-rebased2 00/37\] THP-enabled tmpfs/shmem using compound pages - Kirill A. Shutemov](https://lore.kernel.org/all/1466021202-61880-1-git-send-email-kirill.shutemov@linux.intel.com/)
  - tmpfs/shmem THP
- 2022-11-03 [\[PATCH 0/3\] mm,huge,rmap: unify and speed up compound mapcounts - Hugh Dickins](https://lore.kernel.org/linux-mm/5f52de70-975-e94f-f141-543765736181@google.com/)
  - 简化 mapcount
- May 21, 2024 [Facing down mapcount madness \[LWN.net\]](https://lwn.net/Articles/974223/)
- 2025-05-12 [\[PATCH v2 0/8\] ext4: enable large folio for regular files - Zhang Yi](https://lore.kernel.org/all/20250512063319.3539411-1-yi.zhang@huaweicloud.com/)

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
  - `vma_adjust_trans_huge()` split_vma() 等处理 vma 时用到的 thp: avoid breaking huge pmd invariants in case of vma_adjust failures https://lore.kernel.org/all/201012152357.oBFNvvvi013658@imap1.linux-foundation.org/
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
- 2016-06-06 [[PATCHv9 00/32] THP-enabled tmpfs/shmem using compound pages - Kirill A. Shutemov](https://lore.kernel.org/all/1465222029-45942-1-git-send-email-kirill.shutemov@linux.intel.com/)

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
  write_end():ext4_write_end()
    /* 写完成后就给释放了？？没弄 pagecache 啥的吗 */
    folio_put(folio);
```

在 `filemap_fault()` 的路径上的都是 0-order，也就是说，目前 mmap 文件页是不会 THP 的（tmpfs/shmem 应该除外？）。

### munmap() THP 时

munmap() THP 时需要拆分页表。

```cpp
__split_vma()->vma_adjust_trans_huge()
  split_huge_pmd_if_needed()->split_huge_pmd_address()->...->__split_huge_pmd_locked()
```

细节我放到后面讲吧

### 其他场景

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

对文件页的处理很简单，直接 folio_put 了，为啥？

匿名页则是拆分成 pte

### large folio 拆分

1. 支持拆分为指定 order
2. 非均匀拆分
3. deferred_split 机制

### khugepaged 线程

定期扫描，合并普通页为大页

### THP 收缩机制

### mTHP

[mthp](./mthp.md)

### refcount/mapcount 演进历史
