# 内存规整

- [\[内核内存\] \[arm64\] 内存规整 1---memory-compaction 详解](https://blog.csdn.net/u010923083/article/details/116137687)
- [\[内核内存\] \[arm64\] 内存规整 2---页间内容的迁移（\_\_unmap_and_move 函数)](https://blog.csdn.net/u010923083/article/details/116138670)
- [【原创】（九）Linux 内存管理 - zoned page frame allocator - 4 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11746357.html)
- [Linux 中的 Memory Compaction \[一\] - 知乎](https://zhuanlan.zhihu.com/p/81983973)
- [Linux 中的 Memory Compaction \[二\] - CMA - 知乎](https://zhuanlan.zhihu.com/p/105745299)
- [Linux 中的 Memory Compaction \[三\] - THP - 知乎](https://zhuanlan.zhihu.com/p/117239320)
- [linux 内存源码分析 - 内存碎片整理(实现流程) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5286663.html)
- [linux 内存源码分析 - 内存碎片整理(同步关系) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5432674.html)
- [超详细！Linux 内核内存规整详解](https://blog.csdn.net/feelabclihu/article/details/134343592)

Memory Compaction 可以分为两部分：

1. 收集 page block 内的迁移页和空闲页
2. 基于 Page Migration 技术完成页面迁移，形成一块连续内存。

因此建议先看 [page_migration](./page_migration.md)

截至本文更新时，linux 内核版本为 6.16

- [ ] 整理 .c 文件中被外部调用的函数，梳理下功能点

## patch 分析

- [Memory compaction \[LWN.net\]](https://lwn.net/Articles/368869/)
  - [\[PATCH 0/14\] Memory Compaction v8 - Mel Gorman](https://lore.kernel.org/all/1271797276-31358-1-git-send-email-mel@csn.ul.ie/)

```cpp
3f6c82728f4e mm: migration: take a reference to the anon_vma before migrating
	匿名反向映射增加 migrate_refcount，

7f60c214fd3a mm: migration: share the anon_vma ref counts between KSM and page migration
67b9509b2c68 mm: migration: do not try to migrate unmapped anonymous pages
3fe2011ff51e mm: migration: allow the migration of PageSwapCache pages
e9e96b39f932 mm: allow CONFIG_MIGRATION to be set without CONFIG_NUMA or memory hot-remove
a8bef8ff6ea1 mm: migration: avoid race between shift_arg_pages() and rmap_walk() during migration by not migrating temporary stacks
d7a5752c0c19 mm: export unusable free space index via debugfs
f1a5ab121057 mm: export fragmentation index via debugfs
c175a0ce7584 mm: move definition for LRU isolation modes to a header
748446bb6b5a mm: compaction: memory compaction core
76ab0f530e4a mm: compaction: add /proc trigger for memory compaction
ed4a6d7f0676 mm: compaction: add /sys trigger for per-node memory compaction
56de7263fcf3 mm: compaction: direct compact when a high-order allocation fails
5e7719058079 mm: compaction: add a tunable that decides when memory should be compacted and when it should be reclaimed
4f92e2586b43 mm: compaction: defer compaction using an exponential backoff when compaction fails
```

## 数据结构

```cpp
/*
 * Determines how hard direct compaction should try to succeed.
 * Lower value means higher priority, analogically to reclaim priority.
 * 1. 优先级关系:  COMPACT_PRIO_SYNC_FULL >  COMPACT_PRIO_SYNC_LIGHT > COMPACT_PRIO_ASYNC
 * 2. compation对应的成本：COMPACT_PRIO_SYNC_FULL >  COMPACT_PRIO_SYNC_LIGHT > COMPACT_PRIO_ASYNC
 * 3. COMPACT_PRIO_SYNC_FULL完全同步成功率最高
 */
enum compact_priority {
	// 整个内存规整以同步方式完成（允许阻塞，允许将脏页写回到存储设备上，直到等待完成）
	COMPACT_PRIO_SYNC_FULL,
	MIN_COMPACT_PRIORITY = COMPACT_PRIO_SYNC_FULL,
	// 轻量级同步模式，允许绝大多数祖塞，但是不允许将脏页写回到存储设备上，因为等待时间比较长
	COMPACT_PRIO_SYNC_LIGHT,
	MIN_COMPACT_COSTLY_PRIORITY = COMPACT_PRIO_SYNC_LIGHT,
	DEF_COMPACT_PRIORITY = COMPACT_PRIO_SYNC_LIGHT,
	// 整个内存规整操作以异步方式处理，不允许阻塞
	COMPACT_PRIO_ASYNC,
	INIT_COMPACT_PRIORITY = COMPACT_PRIO_ASYNC
};

/*
 * MIGRATE_ASYNC means never block
 * MIGRATE_SYNC_LIGHT in the current implementation means to allow blocking
 *	on most operations but not ->writepage as the potential stall time
 *	is too significant
 * MIGRATE_SYNC will block when migrating pages
 */
enum migrate_mode {
	/*
	 * 内存碎片整理最常用的模式（默认初始是异步模式），在此模式中不会进行阻塞(但是时间片到了可以进行主动调
	 * 度)，也就是此种模式不会对文件页进行处理，文件页用于映射文件数据使用，这种模式也是对整体系统压力较小
	 * 的模式。
	 */
	MIGRATE_ASYNC,
	/*
	 * 当异步模式整理不了更多内存时，有两种情况下会使用轻同步模式再次整理内存：1.明确表示分配的不是透明大
	 * 页的情况下；2.当前进程是内核线程的情况下。这个模式中允许大多数操作进行阻塞(比如隔离了太多页，需要阻
	 * 塞等待一段时间)。这种模式会处理匿名页和文件页，但是不会对脏文件页执行回写操作，而当处理的页正在回写
	 * 时，也不会等待其回写结束。
	 */
	MIGRATE_SYNC_LIGHT,
	/*
	 * 所有操作都可以进行阻塞，并且会等待处理的页回写结束，并会对文件页、匿名页进行回写到磁盘，所以导致最
	 * 耗费系统资源，对系统造成的压力最大。它会在三种情况下发生：
	 * 	1. 从cma中分配内存时；
	 * 	2. 调用alloc_contig_range()尝试分配一段指定了开始页框号和结束页框号的连续页框时；
	 * 	3. 通过写入1到sysfs中的/vm/compact_memory文件手动实现同步内存碎片整理。
	 * 同步模式会增加推迟计数器阀值，并且在同步模式下，会设置好compact_control，让同步模式时忽略
	 * pageblock的PB_migrate_skip标记
	 */
	MIGRATE_SYNC,
};

enum migrate_reason {
	MR_COMPACTION,
	MR_MEMORY_FAILURE,
	MR_MEMORY_HOTPLUG,
	MR_SYSCALL,		/* also applies to cpusets */
	MR_MEMPOLICY_MBIND,
	MR_NUMA_MISPLACED,
	MR_CONTIG_RANGE,
	MR_LONGTERM_PIN,
	MR_DEMOTION,
	MR_DAMON,
	MR_TYPES
};
```

内存规整(compact)中会调用 migrate_pages()，同时也会设置迁移模式(位于 compact_control->mode)。
若是 sysfs 主动触发的内存规整会用 MIGRATE_SYNC 模式；
若是 kcompactd 触发的规整会用 MIGRATE_SYNC_LIGHT 模式；
若是内存分配 slowpath 中触发的会根据 compact prior 去设置用 MIGRATE_ASYNC 或 MIGRATE_SYNC_LIGHT 模式。

在内存不足以分配连续页框后导致内存碎片整理时，首先会进行异步的内存碎片整理，如果异步的内存碎片整理后还是不能够获取连续的页框(这种情况发生在很多离散的页的类型是 MIGRATE_RECLAIMABLE)，并且 gfp_mask 明确表示不处理透明大页的情况或者该进程是个内核线程时，则进行轻同步的内存碎片整理。

在 kswapd 中，永远只进行异步的页面迁移，不会进行同步的页面迁移，并且在 kswapd 中会跳过标记了 PB_migrate_skip 的 pageblock。相反非 kswapd 中的页面迁移，当推迟次数超过了推迟阀值时，会将 pageblock 的 PB_migrate_skip 标记清除，也就是会扫描之前有 PB_migrate_skip 标记的 pageblock。

在同步页面迁移时，会忽略所有标记了 PB_migrate_skip 的 pageblock，强制对这段内存中所有 pageblock 进行扫描(当然除了 MIGRATE_UNMOVEABLE 的 pageblock)。

- 异步是用得最多的，它整理的速度最快，因为它只处理 MIGRATE_MOVABLE 和 MIGRATE_CMA 两种类型，并且不处理脏页和阻塞的情况，遇到需要阻塞的情况就返回。
- 而轻同步的情况是在异步无法有效的整理足够内存时使用，它会处理 MIGRATE_RECLAIMABLE、MIGRATE_MOVABLE、MIGRATE_CMA 三种类型的页框，在一些阻塞情况也会等待阻塞完成(比如磁盘设备回写繁忙，待移动的页正在回写)，但是它不会对脏文件页进行回写操作。
- 同步整理的情况就是在轻同步的基础上会对脏文件页进行回写操作。

这里需要说明一下，非文件映射页也是有可能被当成脏页的，当它加入 swapcache 后会被标记为脏页，不过在内存碎片整理时，即使匿名页被标记为脏页也不会被回写，它只有在内存回收时才会对脏匿名页进行回写到 swap 分区。在脏匿名页进行回写到 swap 分区后，基本上此匿名页占用的页框也快被释放到伙伴系统中作为空闲页框了。

```cpp
/* 描述内存规整完成后的状态信息

   COMPACT_SKIPPED: 跳过此zone，可能此zone不适合
   COMPACT_DEFERRED: 此zone不能开始，是由于此zone最近失败过
   COMPACT_CONTINUE: 继续尝试做page compaction
   COMPACT_COMPLETE: 对整个zone扫描已经完成，但是没有规整出合适的页
   COMPACT_PARTIAL_SKIPPED: 扫描了部分的zone，但是没有找到合适的页
   COMPACT_SUCCESS: 规整成功，并且合并出空闲的页
*/
/* Return values for compact_zone() and try_to_compact_pages() */
/* When adding new states, please adjust include/trace/events/compaction.h */
enum compact_result {
	/* For more detailed tracepoint output - internal to compaction */
	COMPACT_NOT_SUITABLE_ZONE,
	/*
	 * compaction didn't start as it was not possible or direct reclaim
	 * was more suitable
	 */
	COMPACT_SKIPPED,
	/* compaction didn't start as it was deferred due to past failures */
	COMPACT_DEFERRED,
	/* For more detailed tracepoint output - internal to compaction */
	COMPACT_NO_SUITABLE_PAGE,
	/* compaction should continue to another pageblock */
	COMPACT_CONTINUE,
	/*
	 * The full zone was compacted scanned but wasn't successful to compact
	 * suitable pages.
	 */
	COMPACT_COMPLETE,
	/*
	 * direct compaction has scanned part of the zone but wasn't successful
	 * to compact suitable pages.
	 */
	COMPACT_PARTIAL_SKIPPED,
	/* compaction terminated prematurely due to lock contentions */
	COMPACT_CONTENDED,
	/*
	 * direct compaction terminated after concluding that the allocation
	 * should now succeed
	 */
	COMPACT_SUCCESS,
};
```

---

术语解释：

- direct compaction: 不同于 kcompactd 的
- direct reclaim: 不同于 kswapd 的？

## 核心流程

以[buddy](./buddy.md) system 分配内存时进入慢速分配流程为例，

```cpp
struct page *__alloc_pages_slowpath(gfp_t gfp_mask, unsigned int order, struct alloc_context *ac)
  __alloc_pages_direct_compact()


struct page *__alloc_pages_direct_compact()
  try_to_compact_pages()

/* 内存规整核心函数，3 种触发方式最后都会调用该函数 */
enum compact_result compact_zone(struct compact_control *cc, struct capture_control *capc)

```

## 到目前为止的变动

## 触发条件

1. 伙伴系统分配内存，进入慢速分配流程 `__alloc_pages_slowpath()`，若降低 watermak 值和进行 kswap 内存回收操作后，系统内存仍然吃紧，则伙伴系统会触发 memory-compaction。
2. linux os 内存吃紧，kcompactd 线程唤醒触发 memory-compaction.
3. 手动触发。`echo 1 > /sys/devices/system/node/nodexx/compact` 或 `echo 1 > /proc/sys/vm/compact_memory`

## 一些 patch

- [\[PATCH v6 00/11\] make direct compaction more deterministic - Vlastimil Babka](https://lore.kernel.org/all/20160810091226.6709-1-vbabka@suse.cz/)
- [\[PATCH v6 00/13\] compaction: balancing overhead and success rates - Vlastimil Babka](https://lore.kernel.org/all/1407142524-2025-1-git-send-email-vbabka@suse.cz/)
