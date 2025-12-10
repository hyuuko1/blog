# 页面迁移（Page Migration）

推荐阅读：

- [Page migration \[LWN.net\]](https://lwn.net/Articles/157066/)
- [VM followup: page migration and fragmentation avoidance \[LWN.net\]](https://lwn.net/Articles/160201/)
- [A herd of migration discussions \[LWN.net\]](https://lwn.net/Articles/1015551/)
- [\[PATCH 0/5\] Swap Migration V5: Overview - Christoph Lameter](https://lore.kernel.org/all/20051101031239.12488.76816.sendpatchset@schroedinger.engr.sgi.com/)
- [\[PATCH 0/5\] Direct Migration V9: Overview - Christoph Lameter](https://lore.kernel.org/all/20060110224114.19138.10463.sendpatchset@schroedinger.engr.sgi.com/)
- [宋宝华：论 Linux 的页迁移（Page Migration）完整版](https://cloud.tencent.com/developer/article/1681326)
- [linux 那些事之页迁移(page migratiom) - yooooooo](https://www.cnblogs.com/linhaostudy/p/17647370.html)
- [linux 内存源码分析 - 内存碎片整理(同步关系) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5432674.html)
- [\[内核内存\] \[arm64\] 内存规整 2---页间内容的迁移（\_\_unmap_and_move 函数)](https://blog.csdn.net/u010923083/article/details/116138670?spm=1001.2014.3001.5501)
- [LWN: 让 ZONE_MOVABLE 更加名副其实！-CSDN 博客](https://blog.csdn.net/Linux_Everything/article/details/113667395)
- [对于 ZONE_MOVABLE 的理解\_zone movable-CSDN 博客](https://blog.csdn.net/rikeyone/article/details/86498298)
- [对于 MIGRATE_MOVABLE 的理解\_movable migrate type-CSDN 博客](https://blog.csdn.net/rikeyone/article/details/105863277)
- [内存管理中关于 Movable 的理解 - aspirs - 博客园](https://www.cnblogs.com/aspirs/p/12781693.html)

why？依赖于页面迁移的技术（具体可以看 `enum migrate_reason`）：

- 进程被迁移到其他 NUMA node 时，需迁移页面防止性能下降。这是页面迁移最初要解决的问题。
- [内存反碎片](./anti-fragmentation.md)
  - [内存规整](./compaction.md)
  - [内存热插拔](./hotplug.md)
  - [CMA](./cma.md)
- [CoW](./cow.md)
- [THP](./thp.md)
- syscall migrate_pages
- Remapping of bad pages. These could be detected through soft ECC errors and other mechanisms.
  https://lwn.net/Articles/156603/

how？页面迁移依赖的技术：

- [反向映射](./rmap.md)
  - 匿名页的反向映射
  - 文件页的反向映射
- [页面引用计数](./folio.md)

什么会阻止页面交换？

- pin 住的页面
- 用于 direct I/O 的页面
- 有人在使用不能修改页表的映射

## PATCH: Swap Migration V5

- [\[PATCH\] Add page migration support via swap to the NUMA policy layer - Christoph Lameter](https://lore.kernel.org/all/Pine.LNX.4.62.0510131114140.14810@schroedinger.engr.sgi.com/)
- [\[PATCH 0/2\] Page migration via Swap V2: Overview - Christoph Lameter](https://lore.kernel.org/all/20051018004932.3191.30603.sendpatchset@schroedinger.engr.sgi.com/)
- [\[PATCH 0/4\] Swap migration V3: Overview - Christoph Lameter](https://lore.kernel.org/all/20051020225935.19761.57434.sendpatchset@schroedinger.engr.sgi.com/)
- [\[PATCH 0/5\] Swap Migration V4: Overview - Christoph Lameter](https://lore.kernel.org/all/20051025193023.6828.89649.sendpatchset@schroedinger.engr.sgi.com/)
- [\[PATCH 0/5\] Swap Migration V5: Overview - Christoph Lameter](https://lore.kernel.org/all/20051101031239.12488.76816.sendpatchset@schroedinger.engr.sgi.com/)

```cpp
21eac81f252f [PATCH] Swap Migration V5: LRU operations
	新增两个函数
	isolate_lru_page() 从 LRU 取出该 page 并将其放进 indicated list
	putpack_lru_page() 将链表上的 pages 放回 LRU
930d915252ed [PATCH] Swap Migration V5: PF_SWAPWRITE to allow writing to swap
49d2e9cc4544 [PATCH] Swap Migration V5: migrate_pages() function
7cbe34cf86c6 [PATCH] Swap Migration V5: Add CONFIG_MIGRATION for page migration support
dc9aa5b9d65f [PATCH] Swap Migration V5: MPOL_MF_MOVE interface
39743889aaf7 [PATCH] Swap Migration V5: sys_migrate_pages interface
8419c3181086 [PATCH] SwapMig: CONFIG_MIGRATION fixes
1480a540c985 [PATCH] SwapMig: add_to_swap() avoid atomic allocations
ee27497df368 [PATCH] SwapMig: Drop unused pages immediately
d498471133ff [PATCH] SwapMig: Extend parameters for migrate_pages()
d0d963281ccb [PATCH] SwapMig: Switch error handling in migrate_pages to use -Exx
```

最初的实现方案：遍历进程的内存，并强制需要迁移的页面进行交换。当进程将页面重新加载到内存中时，它应该在进程的当前节点上分配。

## PATCH: Direct Migration V9

- [\[PATCH 0/5\] Direct Migration V9: Overview - Christoph Lameter](https://lore.kernel.org/all/20060110224114.19138.10463.sendpatchset@schroedinger.engr.sgi.com/)

```cpp
b16664e44c54 [PATCH] Direct Migration V9: PageSwapCache checks
a48d07afdf18 [PATCH] Direct Migration V9: migrate_pages() extension
a3351e525e47 [PATCH] Direct Migration V9: remove_from_swap() to remove swap ptes
7e2ab150d1b3 [PATCH] Direct Migration V9: upgrade MPOL_MF_MOVE and sys_migrate_pages()
e965f9630c65 [PATCH] Direct Migration V9: Avoid writeback / page_migrate() method
```

## 系统调用

migrate_pages

不是很常用吧

将指定 old_nodes 节点上属于进程 pid 的所有物理页迁移到 new_nodes 节点上

```cpp
SYSCALL_DEFINE4(migrate_pages, pid_t, pid, unsigned long, maxnode,
		const unsigned long __user *, old_nodes,
		const unsigned long __user *, new_nodes)

unmap_and_move

set_mempolicy()
MPOL_MF_MOVE
```

## ZONE_MOVABLE

- [【原创】（五）Linux 内存管理 zone_sizes_init - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11568481.html)
- 《Linux 内核深度解析》3.7.3 根据可移动性分组。

```cpp
/* 9 */
#define pageblock_order		MIN_T(unsigned int, HUGETLB_PAGE_ORDER, MAX_PAGE_ORDER)
/* 512 */
#define pageblock_nr_pages	(1UL << pageblock_order)
```

在系统长时间运行后，物理内存可能出现很多碎片，可用物理页很多，但是最大的连续物理内存可能只有一页。内存碎片对用户程序不是问题，因为用户程序可以通过页表把连续的虚拟页映射到不连续的物理页。但是内存碎片对内核是一个问题，因为内核使用直接映射的虚拟地址空间，连续的虚拟页必须映射到连续的物理页。

简单来说，可迁移的页面不一定都在 ZONE_MOVABLE 中，但是 ZONE_MOVABLE 中的页面必须都是可迁移的。

- 给用户分配的匿名页，使用的是 `GFP_HIGHUSER_MOVABLE` 包含了 `__GFP_HIGHMEM | __GFP_MOVABLE`，意味着可以从 ZONE_MOVABLE 分配。
- 分配给内核使用的内存，都是不可移动的（因为存在线性映射，这个映射不能修改），所以不能从 ZONE_MOVABLE 分配。
  - XXX vmalloc 分配的内存，不是线性映射的，应该可以移动？为什么不从 ZONE_MOVABLE 分配呢？为什么要用 GFP_KERNEL 呢？
  - 分配大页时，ZONE_MOVABLE 的内存因为可以直接迁移，所以从 ZONE_MOVABLE 分配大页应该比较容易？

## migratetype

为了预防内存碎片，内核根据可移动性把物理页分为 3 种类型（体现在：3 种类型的位于不同的 pcp list 里）。

1. 不可移动页：位置必须固定，不能移动，直接映射到内核虚拟地址空间的页，比如 kmalloc 申请的页面，属于这一类。
2. 可移动页：使用页表映射的页属于这一类，可以移动到其他位置，然后修改页表映射。
3. 可回收页：不能移动，但可以回收，需要数据的时候可以重新从数据源获取。后备存储设备支持的页属于这一类。

内核把具有相同可移动性的页分组。为什么这种方法可以减少碎片？试想：如果不可移动页出现在可移动内存区域的中间，会阻止可移动内存区域合并。这种方法把不可移动页聚集在一起，可以防止不可移动页出现在可移动内存区域的中间。

```cpp
/* 迁移类型 */
enum migratetype {
	/* 不可移动页，主要是内核分配的页（linux内核分配页很多是线性映射的页，
	这些页的虚拟地址和物理地址是通过固定的偏移进行映射的，
	因此不能将物理页的内容移动到其他空闲物理页中） */
	MIGRATE_UNMOVABLE,
	/* 可移动页，能将页中的内容迁移到其他物理页中，主要是一些用户空间分配的页 */
	MIGRATE_MOVABLE,
	/* 可回收页，不能迁移，但能进行回收处理 */
	MIGRATE_RECLAIMABLE,
	MIGRATE_PCPTYPES,	/* the number of types on the pcp lists */
	MIGRATE_HIGHATOMIC = MIGRATE_PCPTYPES,
#ifdef CONFIG_CMA
	/* MIGRATE_CMA 被设计成模拟 ZONE_MOVABLE 工作的方式， */
	/*
	 * MIGRATE_CMA migration type is designed to mimic the way
	 * ZONE_MOVABLE works.  Only movable pages can be allocated
	 * from MIGRATE_CMA pageblocks and page allocator never
	 * implicitly change migration type of MIGRATE_CMA pageblock.
	 *
	 * The way to use it is to change migratetype of a range of
	 * pageblocks to MIGRATE_CMA which can be done by
	 * __free_pageblock_cma() function.
	 */
	MIGRATE_CMA,
#endif
#ifdef CONFIG_MEMORY_ISOLATION
	MIGRATE_ISOLATE,	/* can't allocate from here */
#endif
	MIGRATE_TYPES
};
```

MIGRATE_RECLAIMABLE 不可以迁移，但是可以回收，主要是 SLAB，而非 page cache。
从 inode_init_always_gfp()->mapping_set_gfp_mask(mapping, GFP_HIGHUSER_MOVABLE) 克制 page cache 是 MIGRATE_MOVABLE，而不是 MIGRATE_RECLAIMABLE，很多博客文章都写错了。

前面 3 种是真正的迁移类型，后面的迁移类型都有特殊用途： MIGRATE_HIGHATOMIC 用于高阶原子分配，MIGRATE_CMA 用于连续内存分配器，MIGRATE_ISOLATE 用来隔离物理页（由连续内存分配器、内存热插拔和从内存硬件错误恢复等功能使用）。

pageblock_order 是按可移动性分组的阶数，简称分组阶数，可以理解为一种迁移类型的一个页块的最小长度。如果内核支持巨型页，那么 pageblock_order 是巨型页的阶数，否则 pageblock_order 是伙伴分配器的最大分配阶。

同一个 pageblock 内的页面，迁移类型是相同的。

TODO 疑问：为啥会有 pageblock 这种东西。有了 pageblock 后，就有很多连续 2M 的相同的迁移类型的页面，感觉确实有利于做页面迁移得到更多连续页。

申请某种迁移类型的页时，如果这种迁移类型的页用完了，可以从其他迁移类型盗用（steal）物理页。
如果需要从备用类型盗用物理页，那么从最大的页块开始盗用，以避免产生碎片。
内核定义了每种迁移类型的备用类型优先级列表：

```cpp
static int fallbacks[MIGRATE_PCPTYPES][MIGRATE_PCPTYPES - 1] = {
	[MIGRATE_UNMOVABLE]   = { MIGRATE_RECLAIMABLE, MIGRATE_MOVABLE   },
	[MIGRATE_MOVABLE]     = { MIGRATE_RECLAIMABLE, MIGRATE_UNMOVABLE },
	[MIGRATE_RECLAIMABLE] = { MIGRATE_UNMOVABLE,   MIGRATE_MOVABLE   },
};
```

函数 `set_pageblock_migratetype()` 用来在页块标志位图中设置页块的迁移类型，函数 `get_pageblock_migratetype()` 用来获取页块的迁移类型。

**内核在初始化时，把所有页块初始化为可移动类型，其他迁移类型的页是盗用产生的。**

```cpp
memmap_init_zone_range()
  memmap_init_range(, MIGRATE_MOVABLE)
```

```bash
# 查看各种迁移类型的页的分布情况
$ cat /proc/pagetypeinfo
```

## 代码分析

- MIGRATE_ASYNC
  - 异步迁移，过程中不会发生阻塞
  - 场景：内存分配 slowpath
- MIGRATE_SYNC_LIGHT
  - 轻度同步迁移，允许大部分的阻塞操作，唯独不允许脏页的回写操作
  - 场景：内存分配 slowpath、kcompactd 触发的规整
- MIGRATE_SYNC
  - 同步迁移，迁移过程会发生阻塞，若需要迁移的某个 page 正在 writeback 或被 locked 会等待它完成
  - 场景：sysfs 主动触发的内存规整

场景：

- migrate_pages() Returns the number of {normal folio, large folio, hugetlb} that were not migrated, or an error code.

Migratability of hugepages depends on architectures and their size.

```cpp
/* 传入链表要迁移的 folio 链表 from，未能成功被迁移的 folio 会保留在这个链表里，
  */
migrate_pages()
  /*  */
  migrate_hugetlbs()
  if (mode == MIGRATE_ASYNC)
    migrate_pages_batch()
  else
    migrate_pages_sync()

migrate_pages_batch()
  好几种情况
  1. 如果在 _deferred_list 链表里，那就先 split


migrate_folio()

try_to_migrate_one()
```

- hugetlb 的页面迁移支持
  - 2010-09-08 290408d4a250 hugetlb: hugepage migration core
