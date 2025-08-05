# Memory Reclaim

- 🌟 [linux 内存回收 之 File page 的 lru list 算法原理 - 知乎](https://zhuanlan.zhihu.com/p/421298579)
- 🌟 [Linux memory workingset 内存工作集 - 知乎](https://zhuanlan.zhihu.com/p/10798919273)
- 🌟 [Linux page reclaim 内存回收 - 知乎](https://zhuanlan.zhihu.com/p/8073214749)
- 🌟 [Linux memory watermark 内存水位 - 知乎](https://zhuanlan.zhihu.com/p/697378785)
- 🌟 [Linux 内存调节之 zone watermark - 知乎](https://zhuanlan.zhihu.com/p/73539328)
- 🌟 [一文讲透 MGLRU - 知乎](https://zhuanlan.zhihu.com/p/697963587)
- 🌟 [linux 内存源码分析 - 内存回收(整体流程) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5435068.html)
  有错误。page cache 不是 MIGRATE_RECLAIMABLE，而是 MIGRATE_MOVABLE
- 🌟 [linux 内存源码分析 - 内存回收(lru 链表) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5447448.html)
- 🌟 [linux 内存源码分析 - 直接内存回收中的等待队列 - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5481419.html)
- [Linux Swap 与 Zram 详解 - 泰晓科技](https://tinylab.org/linux-swap-and-zram/)
- [【原创】（十）Linux 内存管理 - zoned page frame allocator - 5 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11827153.html)
- [Linux 中的内存回收 \[一\] - 知乎](https://zhuanlan.zhihu.com/p/70964195)
- [Linux 中的内存回收 \[二\] - 知乎](https://zhuanlan.zhihu.com/p/72998605)
- [Linux 内存回收之 drop cache - 知乎](https://zhuanlan.zhihu.com/p/93962657)
- [Linux - 再议内存回收之 swappiness - 知乎](https://zhuanlan.zhihu.com/p/499738178)
- [\[内核内存\] \[arm64\] 内存回收 1---LRU 链表机制](https://blog.csdn.net/u010923083/article/details/116145038)
- [\[内核内存\] \[arm64\] 内存回收 2---快速内存回收和直接内存回收](https://blog.csdn.net/u010923083/article/details/116278292)
- [\[内核内存\] \[arm64\] 内存回收 3---kswapd 内核线程回收](https://blog.csdn.net/u010923083/article/details/116278405)
- [\[内核内存\] \[arm64\] 内存回收 4---shrink_node 函数详解](https://blog.csdn.net/u010923083/article/details/116278456)
- [\[内核内存\] \[arm64\] 内存回收 5---add_to_swap 函数详解](https://blog.csdn.net/u010923083/article/details/116301277)
- [kswapd 介绍](https://blog.csdn.net/feelabclihu/article/details/124054410)

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

- `watermark[WMARK_HIGH]` 是 zone 对于空闲页框数量比较满意的一个值，当 zone 的空闲页框数量高于这个值时，表示 zone 的空闲页框较多。所以对 zone 进行内存回收时，目标也是希望将 zone 的空闲页框数量提高到此值以上，系统会使用此阀值用于 OOM killer 进行内存回收。
- `watermark[WMARK_LOW]` 是快速分配的默认阀值，在分配内存过程中，如果 zone 的空闲页框数量低于此阀值，系统会对 zone 执行快速内存回收
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
这里只讨论 lru 链表中的页：

- 干净文件页，释放；
- 脏文件页，写回，再释放；
- 匿名页，交换，再释放。
- shmem 使用的页

除了一些特殊的页面分配方法（比如在映射时即进行页面分配，以提高性能）之外，大多用户进程的页（无论是文件页还是匿名页）都是通过 page fault 进行分配的。这些属于用户进程的页中，除了 PG_unevictable 修饰（不可回收）的页面都是可以进行回收的（比如 ramfs 所属页、mlock()的页等）。
当页面通过 page fault 被分配的时候，文件 page cache 被加入到非活动链表中(inactive list)， 匿名页(anonymous page)被加入到活动链表中(active list)。

内存回收并不是一个孤立的功能，它内部会涉及到其他很多东西，比如内存分配、lru 链表、反向映射、swapcache、pagecache 等。

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

##

1. direct synchronous page reclaim 直接内存回收
