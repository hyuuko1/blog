# Buddy System 伙伴系统: Linux 物理内存分配

## 参考

- [一步一图带你深入理解 Linux 物理内存管理 - 知乎](https://zhuanlan.zhihu.com/p/585395024)
- [深入理解 Linux 物理内存分配全链路实现 - 知乎](https://zhuanlan.zhihu.com/p/595356681)
- [深度剖析 Linux 伙伴系统的设计与实现 - 知乎](https://zhuanlan.zhihu.com/p/603268284)

## 概览

1. buddy system 减缓内存外碎片问题
2. 在内核中，以阶（order）来表示块（块，在这里指一段连续的物理页面）的大小，块共有 2^0, 2^1, ... 2^10，共 11 (`NR_PAGE_ORDERS`) 种大小，阶分别是 0, 1, ... 10。
3. 内存申请优先从小的块开始，释放一个块的时候，如果它的伙伴也处于空闲状态，那就将二者合并成一个更大的块，合并后如果其伙伴页空闲，就继续合并。
4. 什么是伙伴？需要满足以下几个条件；
   1. 处于同一个 zone
   2. 相邻
   3. 阶相等，假设阶都为 n
   4. 对于互为伙伴的两个块，地址更低的块的地址必须是 2^n+1 页对齐的，否则不能合并。这是因为阶为 n+1 的块，其地址必须是 2^n+1 对齐的。

注：`MAX_ORDER` 已被重命名为了 `MAX_PAGE_ORDER`，详见 [\[PATCH, REBASED 2/2\] mm, treewide: Rename MAX_ORDER to MAX_PAGE_ORDER - Kirill A. Shutemov](https://lore.kernel.org/all/20231228144704.14033-2-kirill.shutemov@linux.intel.com/)

## 接口

### /proc

```bash
# 共 NR_PAGE_ORDERS 11 列，代表不同阶的已分配的页面数量，从左到右 0 到 10。
# 详见 frag_show_print()
$ cat /proc/buddyinfo
Node 0, zone      DMA      0      0      0      0      0      0      0      0      0      1      3
Node 0, zone    DMA32      1      4      2      3      3      2      2      2      4      4    472
Node 0, zone   Normal     39     16     14      4      7      5      5      2      1      1    479
Node 1, zone   Normal     21     20      8      9      8      3      1      2      0      1    992

# 更详细
$ cat /proc/pagetypeinfo
Page block order: 9
Pages per block:  512

Free pages count per migrate type at order       0      1      2      3      4      5      6      7      8      9     10
Node    0, zone      DMA, type    Unmovable      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone      DMA, type      Movable      0      0      0      0      0      0      0      0      0      1      3
Node    0, zone      DMA, type  Reclaimable      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone      DMA, type   HighAtomic      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone      DMA, type          CMA      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone      DMA, type      Isolate      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone    DMA32, type    Unmovable      0      0      0      0      0      0      0      0      1      1      0
Node    0, zone    DMA32, type      Movable      1      4      2      3      3      2      2      2      3      3    472
Node    0, zone    DMA32, type  Reclaimable      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone    DMA32, type   HighAtomic      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone    DMA32, type          CMA      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone    DMA32, type      Isolate      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone   Normal, type    Unmovable     32     12      7      2      4      2      1      0      0      0      0
Node    0, zone   Normal, type      Movable      5      0      2      1      1      0      1      1      1      1    479
Node    0, zone   Normal, type  Reclaimable      2      4      5      1      2      3      3      1      0      0      0
Node    0, zone   Normal, type   HighAtomic      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone   Normal, type          CMA      0      0      0      0      0      0      0      0      0      0      0
Node    0, zone   Normal, type      Isolate      0      0      0      0      0      0      0      0      0      0      0

Number of blocks type     Unmovable      Movable  Reclaimable   HighAtomic          CMA      Isolate
Node 0, zone      DMA            1            7            0            0            0            0
Node 0, zone    DMA32            2         1014            0            0            0            0
Node 0, zone   Normal           26          994            4            0            0            0
Page block order: 9
Pages per block:  512

Free pages count per migrate type at order       0      1      2      3      4      5      6      7      8      9     10
Node    1, zone   Normal, type    Unmovable      0      1      1      1      1      1      0      0      0      0      0
Node    1, zone   Normal, type      Movable      9     13      2      2      0      0      0      1      0      1    992
Node    1, zone   Normal, type  Reclaimable      2      2      5      6      7      2      1      1      0      0      0
Node    1, zone   Normal, type   HighAtomic      0      0      0      0      0      0      0      0      0      0      0
Node    1, zone   Normal, type          CMA      0      0      0      0      0      0      0      0      0      0      0
Node    1, zone   Normal, type      Isolate      0      0      0      0      0      0      0      0      0      0      0

Number of blocks type     Unmovable      Movable  Reclaimable   HighAtomic          CMA      Isolate
Node 1, zone   Normal           26         2020            2            0            0            0
```

### 函数接口

参数是 `order`，即，申请的内存只能是一整块，也就是 `2^order` 个连续页面。(`order` <= `MAX_PAGE_ORDER`)。

写代码时，如果不要求连续内存，应优先多次 `alloc_page()` 分配多个分散的 0 阶页面。

注意，以下都是宏，我写成了函数声明的形式。

```cpp

struct page *alloc_page(gfp_t gfp)
/* 从当前 cpu 最近的 node 申请物理页面 */
struct page *alloc_pages(gfp_t gfp, unsigned int order)
/* 优先从指定的 node 申请物理页面 */
struct page *alloc_pages_node(int nid, gfp_t gfp, unsigned int order)
struct page *alloc_pages_mpol(gfp_t gfp, unsigned int order, struct mempolicy *pol, pgoff_t ilx, int nid)
alloc_pages_bulk_list()
alloc_pages_bulk_array()
folio_alloc()
folio_alloc_mpol()
vma_alloc_folio()
... 还有一些待整理

/* addr 必须是线性映射区的 */
void free_page(unsigned long addr);
void free_pages(unsigned long addr, unsigned int order);
void __free_page(struct page *page);
void __free_pages(struct page *page, unsigned int order);
```

`gfp_t` 详见 [GFP (Get Free Page)](./gfp.md)

## 数据结构

回顾物理内存管理的层级

1. node
2. zone
3. page

省略了一些字段。

```cpp
#define MAX_PAGE_ORDER 10
#define NR_PAGE_ORDERS (MAX_PAGE_ORDER + 1)

#define PAGE_ALLOC_COSTLY_ORDER 3 /* 0~3 阶的块分配开销被认为是比较大的 */
#define NR_PCP_THP 2 /* 如果开启了透明大页 */
#define NR_LOWORDER_PCP_LISTS (MIGRATE_PCPTYPES * (PAGE_ALLOC_COSTLY_ORDER + 1))
/* pcp list 的种类：0~3 阶的各迁移类型的块，以及透明大页 */
#define NR_PCP_LISTS (NR_LOWORDER_PCP_LISTS + NR_PCP_THP)

/* 表示一个 node */
typedef struct pglist_data {
	struct zone node_zones[MAX_NR_ZONES];
	struct zonelist node_zonelists[MAX_ZONELISTS];
} pg_data_t;

struct zone {
	struct pglist_data	*zone_pgdat;
	/* 一个优化。percpu 的链表，只保持 0 阶空闲块 */
	struct per_cpu_pages	__percpu *per_cpu_pageset;
	struct per_cpu_zonestat	__percpu *per_cpu_zonestats;

	/* 同阶的空闲块被记录在同一个 struct free_area 内 */
	struct free_area	free_area[NR_PAGE_ORDERS];
} ____cacheline_internodealigned_in_smp;

struct per_cpu_pages {
	spinlock_t lock;	/* Protects lists field */
	int count;		/* number of pages in the list */
	/* 0~3 阶的各迁移类型的块 + 以及透明大页，使用不同的链表 */
	struct list_head lists[NR_PCP_LISTS];
} ____cacheline_aligned_in_smp;

/* 记录了某个 zone 内，同阶的空闲块 */
struct free_area {
	/* 相同迁移类型的块在同一链表内 */
	struct list_head	free_list[MIGRATE_TYPES];
	/*  */
	unsigned long		nr_free;
};
```

1. 一个 zone 内，共有 `NR_PAGE_ORDERS * MIGRATE_TYPES = 11 * 6 = 66` 个链表。zone 内同阶且同迁移类型的空闲块，在同一个链表上。
2. 已被分配出去的块不再属于伙伴系统，被释放后才会回到伙伴系统。
3. 对于块的**第一个** page
   1. 可以用 `PageBuddy()` 函数通过 `page_type` 字段的高 8 位，来判断块是否在伙伴系统（是否空闲）
   2. 如果 `PageBuddy()` 为 true，则 `index` 字段表示该块的阶。
4. 块最大为 `2^MAX_PAGE_ORDER * PAGE_SIZE = 4MB`

有关迁移类型，详见[页面迁移](./migration.md)。

## 代码分析

### 分配内存

核心函数是 `__alloc_pages_noprof()`。

`_noprof` 是在 [\[PATCH v6 18/37\] mm: enable page allocation tagging - Suren Baghdasaryan](https://lore.kernel.org/all/20240321163705.3067592-19-surenb@google.com/) 这个 patch 里加上的，是指 no profiling。当 `CONFIG_MEM_ALLOC_PROFILING=y` 时，`alloc_hooks()` 会加上一些 hook？

```cpp
struct page *__alloc_pages_noprof(gfp_t gfp, unsigned int order, int preferred_nid, nodemask_t *nodemask);
```

在其之上的函数有：

```cpp
/* 分配连续的 order 阶物理页面。
    mpol 是指 mempolicy
    noprof 是指 no protection flags () */
struct page *alloc_pages_mpol_noprof(gfp_t gfp, unsigned int order,
			struct mempolicy *pol, pgoff_t ilx, int nid);

/* 分配不连续的 0 阶物理页面。主要用于 vmalloc */
unsigned long alloc_pages_bulk_noprof(gfp_t gfp, int preferred_nid,
			nodemask_t *nodemask, int nr_pages,
			struct list_head *page_list,
			struct page **page_array);

...
```

代码分析

```cpp
__alloc_pages_noprof()
  /* 对 gfp 做一系列调整 */
  gfp &= gfp_allowed_mask;
  gfp = current_gfp_context(gfp);
  alloc_gfp = gfp;
  prepare_alloc_pages(gfp, order, preferred_nid, nodemask, &ac, &alloc_gfp, &alloc_flags)
  alloc_flags |= alloc_flags_nofragment(zonelist_zone(ac.preferred_zoneref), gfp);
  /* 快速路径 */
  struct page *page = get_page_from_freelist(alloc_gfp, order, alloc_flags, &ac);
  /* 如果快速路径失败，则走慢速路径 */
  page = __alloc_pages_slowpath(alloc_gfp, order, &ac);

/* 快速路径 */
get_page_from_freelist()
  struct page *page = rmqueue();
    /* 0~3 阶的块，或透明大页，从 pcp list 中分配  */
    if (likely(pcp_allowed_order(order))) rmqueue_pcplist()
      list = &pcp->lists[order_to_pindex(migratetype, order)];
      __rmqueue_pcplist()
    /* 否则从 zone->free_area 里的链表分配 */
    else rmqueue_buddy()
      __rmqueue()->__rmqueue_smallest()
        for (current_order = order; current_order < NR_PAGE_ORDERS; ++current_order)
	  area = &(zone->free_area[current_order]);
	  page = get_page_from_free_area(area, migratetype);
  prep_new_page(page, order, gfp_mask, alloc_flags);
    if (order && (gfp_flags & __GFP_COMP)) prep_compound_page(page, order);

/* 慢速路径 */
__alloc_pages_slowpath()
```

关于 `current_gfp_context()` 详见 [GFP (Get Free Page)](./gfp.md)

### 释放内存

```cpp
__free_pages()->free_unref_page()
  /* 不能归还到 pcp，直接归还到 buddy */
  if (!pcp_allowed_order(order)) __free_pages_ok()
  /* 归还至 pcp */
  pcp = pcp_spin_trylock(zone->per_cpu_pageset);
  free_unref_page_commit()
    pindex = order_to_pindex(migratetype, order);
    list_add(&page->pcp_list, &pcp->lists[pindex]);

__free_pages_ok()->free_one_page()
  split_large_buddy()
    /* TODO 为什么这里要限制 order 最大为 9，虽说这没什么问题（可以和伙伴合并成 10） */
    if (order > pageblock_order) order = pageblock_order;
```

### 伙伴系统初始化

释放 memblock 的内存到 buddy system

```cpp
mm_core_init()
  build_all_zonelists(NULL);
  mem_init()->memblock_free_all()->free_low_memory_core_early()
    for_each_free_mem_range
      __free_memory_core()->__free_pages_memory()->memblock_free_pages()
        __free_pages_core()->__free_pages_ok()
```

## TODO

- [ ] 梳理：各场景应使用哪种内存分配 API
- [ ] page_order, MAX_ORDER, page_block
      最大支持分配连续的 4MB 内存？
      为什么释放时，为什么 要限制 order 最大为 pageblock_order。
      pageblock_order 是什么？
- [ ] `__folio_alloc_noprof` 加了个 `__GFP_COMP` 参数。
      则会作用于 get_page_from_freelist->prep_new_page。
      所以 folio 和 compound page 啥关系？
- [ ] CONFIG_CMA
- [ ] ALLOC_HIGHATOMIC
- [ ] 慢速路径。内存规整、回收
