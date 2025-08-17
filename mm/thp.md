# THP (Transparent Huge Page) 透明大页

- https://lwn.net/Kernel/Index/#Memory_management-Huge_pages
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

## 功能点梳理

梳理一些关键函数的功能点、与其他模块的交互、使用场景。
梳理完后，再深入分析用到透明大页的每个场景。

---

- 匿名页 THP
  详见 [pagefault](./pagefault.md)
- 文件页 THP
  - 2016-06-06 [[PATCHv9 00/32] THP-enabled tmpfs/shmem using compound pages - Kirill A. Shutemov](https://lore.kernel.org/all/1465222029-45942-1-git-send-email-kirill.shutemov@linux.intel.com/)

---

mm/huge_mm.h mm/huge_memory.c

- sysfs
  - 有点多啊
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
  - `__split_huge_pmd_locked()` 涉及的场景有点多啊，主要是 munmap() 时的大页拆分吧。
  - `__split_huge_pud_locked()`
  - `__folio_split()`
  - `deferred_split_folio()` 把 folio 放进 pgdat/memcg 粒度的 deferred_split_queue 队列
  - `__folio_unqueue_deferred_split()` 将 folio 从 deferred_split_queue 移除
  - `min_order_for_split()` 匿名页最小可以 split 成 0-order 的，而文件页（包括 shm）则由文件系统决定，例如 ext4_set_inode_mapping_order()
  - 非均匀拆分 THP [[PATCH v10 0/8] Buddy allocator like (or non-uniform) folio split - Zi Yan](https://lore.kernel.org/all/20250307174001.242794-1-ziy@nvidia.com/)
  - 回收 THP 时，无需 split MADV_FREE 的 lazyfree THP，提升效率 [[PATCH v8 0/3] Reclaim lazyfree THP without splitting - Lance Yang](https://lore.kernel.org/all/20240614015138.31461-1-ioworker0@gmail.com/)
- debugfs 接口 /sys/kernel/debug/split_huge_pages

---

mm/khugepaged.c 是从 mm/huge_memory.c 拆分出来的，khugepaged 线程相关

---

selftests

- tools/testing/selftests/mm/khugepaged.c
- tools/testing/selftests/mm/split_huge_page_test.c
  - 用于测试 /sys/kernel/debug/split_huge_pages 接口

## 数据结构

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

## debugfs 接口

- /sys/kernel/debug/split_huge_pages
  - [[PATCH v8 1/2] mm: huge_memory: a new debugfs interface for splitting THP tests.](https://lore.kernel.org/all/20210331235309.332292-1-zi.yan@sent.com/)
    - 原有功能：通过写入 `1` 来 split 系统中所有 THP，
    - 新增功能：通过写入 `<pid>,<vaddr_start>,<vaddr_end>` 仅 split 指定进程在特定虚拟地址范围内的 THP
  - [[PATCH v8 2/2] mm: huge_memory: debugfs for file-backed THP split. - Zi Yan](https://lore.kernel.org/all/20210331235309.332292-2-zi.yan@sent.com/)
    - 新增功能：通过写入 `<path>,<pgoff_start>,<pgoff_end>` 仅 split 指定文件特定范围内的 THP 文件页
  - 后面又有 patch，加上了两个参数 `,<new_order>,<in_folio_offset>`
    - in_folio_offset: folio 内部的偏移，单位同样是 4KB
  - 核心函数是 `__folio_split()`

## pagefault 场景

## THP 拆分

页表拆分

---

大页拆分

---

大页拆分的 deferred_split 机制

## khugepaged 线程

定期扫描，合并普通页为大页

## THP 收缩机制

## mTHP

[mthp](./mthp.md)
