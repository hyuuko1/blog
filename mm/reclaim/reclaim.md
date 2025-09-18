# Memory Reclaim

按顺序来看

---

介绍

- [Linux 内存调节之 zone watermark - 知乎](https://zhuanlan.zhihu.com/p/73539328)
- [Linux 中的内存回收 \[一\] - 知乎](https://zhuanlan.zhihu.com/p/70964195)
- [Linux 中的内存回收 \[二\] - 知乎](https://zhuanlan.zhihu.com/p/72998605)
- [Linux 内存回收之 drop cache - 知乎](https://zhuanlan.zhihu.com/p/93962657)
- [Linux - 再议内存回收之 swappiness - 知乎](https://zhuanlan.zhihu.com/p/499738178)

---

- [Linux memory watermark 内存水位 - 知乎](https://zhuanlan.zhihu.com/p/697378785)
- [Linux page reclaim 内存回收 - 知乎](https://zhuanlan.zhihu.com/p/8073214749)
  - 触发路径
  - 页面 active,inactive 平衡、 文件页&匿名页的平衡
  - swappiness
- [Linux memory workingset 内存工作集 - 知乎](https://zhuanlan.zhihu.com/p/10798919273)
  - 有点抽象，很难看懂

---

- [linux 内存回收 之 File page 的 lru list 算法原理 - 知乎](https://zhuanlan.zhihu.com/p/421298579)
  提到了 workingset
- [一文讲透 MGLRU - 知乎](https://zhuanlan.zhihu.com/p/697963587)
- [关于 memcg 下 memory.reclaim 的一些想法 - 知乎](https://zhuanlan.zhihu.com/p/641355613)
- [Linux Swap 与 Zram 详解 - 泰晓科技](https://tinylab.org/linux-swap-and-zram/)

---

代码分析

- [linux 内存源码分析 - 内存回收(整体流程) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5435068.html)
  有错误。page cache 不是 MIGRATE_RECLAIMABLE，而是 MIGRATE_MOVABLE
- [linux 内存源码分析 - 内存回收(lru 链表) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5447448.html)
- [linux 内存源码分析 - 直接内存回收中的等待队列 - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5481419.html)

---

不推荐，想看就看吧

- [\[内核内存\] \[arm64\] 内存回收 1---LRU 链表机制](https://blog.csdn.net/u010923083/article/details/116145038)
- [\[内核内存\] \[arm64\] 内存回收 2---快速内存回收和直接内存回收](https://blog.csdn.net/u010923083/article/details/116278292)
- [\[内核内存\] \[arm64\] 内存回收 3---kswapd 内核线程回收](https://blog.csdn.net/u010923083/article/details/116278405)
- [\[内核内存\] \[arm64\] 内存回收 4---shrink_node 函数详解](https://blog.csdn.net/u010923083/article/details/116278456)
- [\[内核内存\] \[arm64\] 内存回收 5---add_to_swap 函数详解](https://blog.csdn.net/u010923083/article/details/116301277)
- [kswapd 介绍](https://blog.csdn.net/feelabclihu/article/details/124054410)
- [【原创】（十）Linux 内存管理 - zoned page frame allocator - 5 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11827153.html)

## 数据结构

struct page 中与页框回收相关的成员：

1. `unsigned long flags` 详见 [pageflags](./pageflags.md)
   - PG_active、PG_referenced 用于表示当前页的活跃状态，并决定是否回收
   - PG_unevictable 表示当前页不可以回收
   - PG_mlocked 表示当前页被系统调用 mlock()锁定了，禁止换出和释放
   - PG_lru 表示当前页处于 lru 链表中
   - PG_swapcache 表示当前页正在被换出/换入
   - PG_private 及 PG_private_2 分别用来表示一个 zspage 的第一个页和最后一个页
2. `struct address_space mapping`
   末位为 0 时，跟踪当前页映射的文件；为 1 时，指向 anon_vma（包含了 1 至多个 vma）
3. `struct list_head lru`
   用于将当前页加入到某个 lru 的 list
4. 许多 page 的属性在 zram 中另有定义。

## 内存回收的触发条件

以 zone 单位。每个 zone 都有 `watermark[NR_WMARK]` 数组，保存的是各个阀值要求的页框数量。

- `watermark[WMARK_HIGH]` 是 zone 对于空闲页框数量比较满意的一个值，当 zone 的空闲页框数量高于这个值时，表示 zone 的空闲页框较多。所以对 zone 进行内存回收时，目标也是希望将 zone 的空闲页框数量提高到此值以上，系统会使用此阀值用于 OOM killer 进行内存回收。kswapd 也是回收到此水线之上才 kswapd_try_to_sleep()
- `watermark[WMARK_LOW]` 是快速分配的默认阀值，在分配内存过程中，如果 zone 的空闲页框数量低于此阀值，系统会对 zone 执行快速内存回收。
- `watermark[WMARK_MIN]` 在快速分配失败后的慢速分配中会使用此阀值进行分配，如果慢速分配过程中使用此值还是无法进行分配，那就会执行直接内存回收和快速内存回收

查看这 3 个阈值的数值，可以看到这些数值是非常小的，分别占该 zone 的 1.1% 1.4% 1.7%，这些都是在系统初始化期间进行设置的，具体设置函数是 `__setup_per_zone_wmarks()`，根据系统中整个内存的数量与每个 zone 管理的页框数量，计算出每个 zone 的 min 阀值，然后 low 和 high 分别是 min 的 1.25 和 1.5 倍。

- [ ] 如何设置这些值

```bash
$ cat /proc/zoneinfo
...
Node 0, zone    DMA32
  pages free     421415
        boost    0
        min      4815		# 阈值
        low      6018
        high     7221
        promo    8424
        spanned  1044480
        present  520160		# TODO 这个是啥
        managed  425593		# 该 zone 的 page 总数
        cma      0
        protection: (0, 0, 1983, 1983, 1983)
...
```

## 内存回收概述

针对三样东西进行回收：slab、lru 链表中的页、buffer_head。

`shrink_lruvec()` 回收 lru 链表中的页：

- 干净文件页，释放；
- 脏文件页，写回，再释放；
- 匿名页，交换，再释放。
- shmem 使用的页

除了一些特殊的页面分配方法（比如在映射时即进行页面分配，以提高性能）之外，大多用户进程的页（无论是文件页还是匿名页）都是通过 page fault 进行分配的。这些属于用户进程的页中，除了 PG_unevictable 修饰（不可回收）的页面都是可以进行回收的（比如 ramfs 所属页、mlock()的页等）。
当页面通过 page fault 被分配的时候，文件 page cache 被加入到非活动链表中(inactive list)， 匿名页(anonymous page)被加入到活动链表中(active list)。

内存回收并不是一个孤立的功能，它内部会涉及到其他很多东西，比如内存分配、lru 链表、反向映射、swapcache、pagecache 等。

`shrink_slab()` 实际上不只是释放 slab，还会释放 virtio ballon，

## 内存规整、迁移

先看 [compaction](./compaction.md) 和 [migration](./page_migration.md)

## 三种回收

- 快速回收 `node_reclaim()`
- 直接回收 direct reclaim
- kswapd 回收

## 核心流程 `shrink_node()`

## `_refcount`

实际上内存回收做的事情，就是想办法将一些 `_refcount` 不为 0 的页，尝试将它们的 `_refcount` 降到 0，这样系统就可以回收这些页了。

## LRU

在内存回收时，系统会对页加以选择：如果选择经常被用到的页，即便回收了，马上又要被用到，这样不仅不能降低内存紧张的情形，反而会增加系统的负担。所以应当选择不太常用的页（或最近没有被用到的页）来回收。采用的主要算法就是 LRU 算法。

Linux 为了实现该算法，给每个 zone 都提供了 5 个 LRU 链表：

- Active Anon Page，活跃的匿名页，page->flags 带有 PG_active
- Inactive Anon Page，不活跃的匿名页，page->flags 不带有 PG_active
- Active File Cache，活跃的文件缓存，page->flags 带有 PG_active
- Inactive File Cache，不活跃的文件缓存，page->flags 不带有 PG_active
- unevictable，不可回收页，page->flags 带有 PG_unevictable

而 inactive list 尾部的页，将在内存回收时优先被回收（写回或者交换）。

回收的页都是非活动匿名页 lru 链表或者非活动文件页 lru 链表上的页。这些页包括：进程堆、栈、匿名 mmap 共享内存映射、shmem 共享内存映射使用的页、映射磁盘文件的页。

### LRU 缓存

## workingset

## TODO

- [ ] user_proactive_reclaim
  - [Using DAMON for proactive reclaim \[LWN.net\]](https://lwn.net/Articles/863753/)
  - [Proactive compaction \[LWN.net\]](https://lwn.net/Articles/717656/)
  - [Proactive compaction for the kernel \[LWN.net\]](https://lwn.net/Articles/817905/)
  - [Proactively reclaiming idle memory \[LWN.net\]](https://lwn.net/Articles/787611/)
  - [Proactive reclaim for tiered memory and more \[LWN.net\]](https://lwn.net/Articles/894849/)

# 新版

回收哪些东西？(what)
可以被回收的是：可以先释放，后面有机会再重新生成的。可以分为两大类：lru 链表上的页、以及其他通过注册 shrinker 来交代如何释放的资源。

- `shrink_lruvec()` 回收 lru 链表上的页
- `shrink_slab()` 回收 slab cache，以及其他的诸如 virtio ballon 之类的

回收的触发条件有哪些？(when)

- `drop_slab()->shrink_slab()` 用户主动触发
  - echo 2 > /proc/sys/vm/drop_caches
- `shrink_node()`
  - `user_proactive_reclaim()` 用户主动触发
    - /sys/devices/system/node/node0/reclaim
    - /sys/fs/cgroup/memory.reclaim
  - 快速回收 `get_page_from_freelist()->node_reclaim()`
  - 直接回收 `__alloc_pages_slowpath()->__alloc_pages_direct_reclaim()->__perform_reclaim()->try_to_free_pages()->do_try_to_free_pages()->shrink_zones()`
  - kswapd 线程回收 `kswapd()->..->kswapd_shrink_node()`
  - 其他 `try_to_free_mem_cgroup_pages()->do_try_to_free_pages()->shrink_zones()`
    - /sys/fs/cgroup/memory.high
    - /sys/fs/cgroup/memory.max
    - `try_charge_memcg()`

如何回收？(how)

先关注于页面分配时涉及到的内存回收路径，
快速回收、直接回收、kswapd 线程回收，它们最后都会调用 `shrink_node()`，只是 struct scan_control 不一样。

```cpp
/* 直接回收 */
node_reclaim()
  /* 可回收的文件页数量。
  我觉得在 ~RECLAIM_UNMAP|~RECLAIM_WRITE 时，计算出的数量肯定是偏低的，因为 unmapped file 里肯定不能包含所有的 dirty page，甚至数量比 dirty page 还少，这里却用 unmapped 数量减去 dirty 数量 */
  node_pagecache_reclaimable()
  __node_reclaim()
```

从 /proc/zoneinfo 或 /sys/fs/cgroup/memory.stat 的内容来看，
file > inactive_file + active_file，
nr_file_pages > nr_inactive_file + nr_active_file，
即 NR_FILE_PAGES > NR_INACTIVE_FILE + NR_ACTIVE_FILE

**计划**

1. 先写完最核心的 shrink_node，先介绍核心流程，
2. 再写各种场景。快速（不阻塞、满足要求就退出、在快速慢速路径下的 watermark 分别是 low 和 min）、直接、kswapd（到 high 后就停止）
3. 匿名、文件平衡，活跃不活跃平衡后面再写。workingset 后面再写。最重要的是建立起整体轮廓。
4. memcg 后面再写
5. MGLRU 后面再写

先介绍核心框架里涉及的几个函数，而一些比较细节的函数，比如 prepare_scan_control()，先跳过放到后面再将，方便快速掌握核心流程。

### `shrink_slab()`

## 深入细节

### 平衡 active/inactive 和 文件页/匿名页

**prepare_scan_control()**

- active 和 inactive 平衡
  - force_deactivate 是否强制将活跃页面转为不活跃页面。在直接回收场景，如果上一次跳过了回收 active 页面，然后回收失败，下一次强制将 active 转为 inactive
  - may_deactivate 允许哪些类型（anon 或 file）的 active 可以转为 inactive。判断依据是 inactive_is_low()，如果 inactive 少，就可以转。
- 文件页&匿名页的平衡
  - cache_trim_mode 当系统中有大量 inactive 状态文件页时，尝试优先回收文件页，然后再处理匿名页
  - file_is_tiny 当系统文件页极少时，满足条件扫描平衡强制设为 SCAN_ANON，表示只扫描匿名页，平衡匿名页与文件页比例。

常规情况下 page fault 新的 page 是放到 inactive list 所以一般情况下 inactive list 长度相对是偏大的，
XXX 什么情况下会放进 active list？

### workingset

### `isolate_lru_folios()`

### `folio_referenced()`

## 数据结构

### folio_batch

folio 指针数组。

```cpp
struct folio_batch {
	/* 数组大小，最大 PAGEVEC_SIZE = 31 */
	unsigned char nr;
	/* 用于 folio_batch_next() 遍历 folio_batch 中的 folio */
	unsigned char i;
	/* 表明是否执行过 lru_add_drain();
	   在 __folio_batch_release() 中会执行，并将该成员改为 true */
	bool percpu_pvec_drained;
	struct folio *folios[PAGEVEC_SIZE];
};
```

## 其他

- /dev/shmem 以及匿名的共享内存，虽然有对应的 inode、address_space，且 vma_is_anonymous() 返回 true，但是仍然是放在 anon lru 里的，因为这些没有 file backend，而是 swap backed 的。

**如何打破平衡**

swappiness 可以提高匿名页的扫描比例，进一步促进系统回收更多的匿名页，

**我的思考**

如果按比例回收匿名页和文件页，会不会导致这种问题？
某个文件页的活跃程度是比某个匿名页要高的，但前者被回收了，后者没回收。

回收数/扫描数，可以反映回收效率。

##

- 2013-05-13 [\[PATCH 3/4\] mm: Activate !PageLRU pages on mark_page_accessed if page is on local pagevec - Mel Gorman](https://lore.kernel.org/linux-mm/1368440482-27909-4-git-send-email-mgorman@suse.de/)
- 2025-04-02 [\[PATCH v2 8/9\] mm: Remove swap_writepage() and shmem_writepage() - Matthew Wilcox (Oracle)](https://lore.kernel.org/all/20250402150005.2309458-9-willy@infradead.org/)
  在 shrink_folio_list 时，只有 shmem 和 anon 会 pageout，而其他的，比如脏文件页不会 pageout

##

```cpp
folio_mark_accessed()
```

##

- 参考 _The Linux Memory Manager_ 2.6 GFP flags

GFP flags，可以分为几类：

- Physical address zone modifiers
- Watermark modifiers 决定 watermark limit，以及如何使用 zone emergency reserves 内存
  - `__GFP_HIGH` 高优先级，会 set `ALLOC_MIN_RESERVE`，允许使用 min watermak 的 50% 内存。
  - `__GFP_MEMALLOC` 允许访问所有的内存。使用条件：当 caller 保证申请的内存很快会释放时，比如进程退出时等等（将来补充）
  - `__GFP_NOMEMALLOC`

```cpp
/* caller 不能睡眠，高优先级，可以唤醒 kswapd（不能 direct reclaim，会导致睡眠） */
#define GFP_ATOMIC	(__GFP_HIGH|__GFP_KSWAPD_RECLAIM)
```

alloc flags

- ALLOC_NO_WATERMARKS

## 页面分配

watermak

- low。作用：
  - 如果分配内存会导致降低到 low 阈值之下，就 node_reclaim 快速回收内存，
  - 如果快速回收后，仍然解决不了会降到 low 阈值之下这个问题，就进入 slowpath：
    - 唤醒 kswapd 开始 indirect reclaim，直到升到 high 阈值才 kswapd 才停下
    - 使用 min 阈值进行分配内存。
- min。作用：
  - 使用 min 阈值进行分配内存时，如果分配内存会导致降低到 low 阈值之下，进行 direct reclaim

还有 emergency reserves 内存？

```cpp
/* 这里的 frozen 的含义是：还未对分配得到的 page 进行 set_page_refcounted() 将 refcount 置 1，
   详见 https://lore.kernel.org/linux-mm/20241125210149.2976098-14-willy@infradead.org/ */
__alloc_frozen_pages_noprof()
  /* get_page_from_freelist() 从 zone 分配内存时，
     会先计算出，分配 order 后，zone 内剩余内存 free_pages，如果 free_pages <= 水线+保留内存，
     就 node_reclaim() 快速回收内存，如果仍然低于水线，就换到其他 zone。 */
  unsigned int alloc_flags = ALLOC_WMARK_LOW;
  get_page_from_freelist(, alloc_flags);
  /* 如果失败了。则说明分配 order 后，会降到 low 阈值以下。就进入慢速路径*/
  __alloc_pages_slowpath()
    /* 使用 min 阈值 */
    alloc_flags = gfp_to_alloc_flags(gfp_mask, order);
      unsigned int alloc_flags = ALLOC_WMARK_MIN | ALLOC_CPUSET;
    /* 如果 GFP flag 里有 __GFP_KSWAPD_RECLAIM */
    if (alloc_flags & ALLOC_KSWAPD)
      wake_all_kswapds(order, gfp_mask, ac);
    /* 使用 min 阈值分配内存 */
    get_page_from_freelist(gfp_mask, order, alloc_flags, ac);
```

## 相关 patch

- 2016-07-21 [\[PATCH 0/8\] compaction-related cleanups v5 - Vlastimil Babka](https://lore.kernel.org/linux-mm/20160721073614.24395-1-vbabka@suse.cz/)
  - mm, page_alloc: set alloc_flags only once in slowpath
    - 在 slowpath 中只设置一次 slowpath，
    - 新增 gfp_pfmemalloc_allowed() 函数，
  - mm, page_alloc: don't retry initial attempt
- 2023-01-13 [\[PATCH 0/6 v3\] Discard \_\_GFP_ATOMIC - Mel Gorman](https://lore.kernel.org/all/20230113111217.14134-1-mgorman@techsingularity.net/)
  - mm: discard `__GFP_ATOMIC`
    - 移除 `__GFP_ATOMIC`，因为它一直是和 `__GFP_HIGH` 一起使用，
