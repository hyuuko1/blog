# CMA (Contiguous Memory Allocator) 连续内存分配器

## 参考

- 《Linux 内核深度解析》3.20 连续内存分配器
- [CMA 模块学习笔记 - 蜗窝科技](https://www.wowotech.net/memory_management/cma.html)
- [【原创】（十六）Linux 内存管理之 CMA - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/12182594.html)
- [Linux 中的 Memory Compaction \[二\] - CMA - 知乎](https://zhuanlan.zhihu.com/p/105745299)
- [在 Linux 内核模块中使用 CMA 内存分配\_linux cma-CSDN 博客](https://blog.csdn.net/willhq/article/details/124602370)

## 简介

在系统长时间运行后，内存可能碎片化，很难找到连续的物理页，连续内存分配器（Contiguous Memory Allocator，CMA）使得这种情况下分配大的连续内存块成为可能。

嵌入式系统中的许多设备不支持分散聚集和 I/O 映射（是指 IOMMU？），需要连续的大内存块。例如手机上 1300 万像素的摄像头，一个像素占用 3 字节，拍摄一张照片需要大约 37MB 内存。在系统长时间运行后，内存可能碎片化，很难找到连续的物理页，页分配器和块分配器很可能无法分配这么大的连续内存块。

一种解决方案是为设备保留一块大的内存区域，缺点是：当设备驱动不使用的时候（大多数时间手机摄像头是空闲的），内核的其他模块不能使用这块内存。连续内存分配器试图解决这个问题，保留一块大的内存区域，当设备驱动不使用的时候，内核的其他模块可以使用，当然有要求：只有申请可移动类型的页时可以借用；当设备驱动需要使用的时候，把已经分配的页迁移到其他地方，形成物理地址连续的大内存块。

## 软件层次

1. 连续内存分配器是在页分配器的基础上实现的，提供的接口 cma_alloc 用来从 CMA 区域分配页，接口 cma_release 用来释放从 CMA 区域分配的页。
2. 在连续内存分配器的基础上实现了 DMA 映射框架专用的连续内存分配器，简称 DMA 专用连续内存分配器，提供的接口 `dma_alloc_from_contiguous` 用来从 CMA 区域分配页，接口 dma_release_from_contiguous 用来释放从 CMA 区域分配的页。
3. DMA 映射框架从 DMA 专用连续内存分配器分配或释放页，为设备驱动程序提供的接口 `dma_alloc_coherent` 和 `dma_alloc_noncoherent` 用来分配内存，接口 dma_free_coherent 和 dma_free_noncoherent 用来释放内存。
4. 设备驱动程序调用 DMA 映射框架提供的函数来分配或释放内存。

- [ ] 自顶向下将整个流程串一遍？从 `vring_alloc_queue->dma_alloc_coherent` 开始，这部分内容放到将来讲 dma-mapping 的地方吧。kernel/dma/ 全弄明白
  - dma-pool ？

### 代码结构

- kernel/dma/contiguous.c
- mm/cma.c
- mm/cma.h

## 数据结构

```cpp
struct cma {
	unsigned long   base_pfn;	/* CMA 区域的起始页帧号 */
	unsigned long   count;		/* 页数 */
	unsigned long   *bitmap;	/* 每个位描述页的分配状态，1 表示已分配 */
	unsigned int order_per_bit;	/* 位图中每隔 bit 描述的物理页面阶数，目前
					   取值为0，表示每个 bit 描述一页 */
	spinlock_t	lock;

	char name[CMA_MAX_NAME];

	bool reserve_pages_on_error;
};

/* 一个 struct cma 数组，记录了所有的 cma 区域。开启 CONFIG_NUMA 时，默认最多 20 个 */
struct cma cma_areas[MAX_CMA_AREAS];
unsigned cma_area_count;

/* 迁移类型 */
enum migratetype {
	MIGRATE_UNMOVABLE,
	MIGRATE_MOVABLE,
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

关于 `migratetype`，详见[页面迁移](./migration.md)。

## 初始化 CMA 区域

- `CONFIG_CMA`，启用连续内存分配器。
- `CONFIG_CMA_AREAS`，指定 CMA 区域的最大数量，默认值是 7。
- `CONFIG_DMA_CMA`，启用允许设备驱动分配内存的连续内存分配器。
- [ ] `CONFIG_DMA_NUMA_CMA` 干啥用的？

CMA 区域分为全局 CMA 区域和设备私有 CMA 区域。全局 CMA 区域是由所有设备驱动共享的，设备私有 CMA 区域由指定的一个或多个设备驱动使用。

配置 CMA 区域有 3 种方法。

1. 内核参数 `cma=nn[MG]@[start[MG][-end[MG]]]`
2. 编译时通过 `CONFIG_CMA_SIZE_SEL_MBYTES` 和 `CONFIG_CMA_SIZE_SEL_PERCENTAGE` 配置全局 CMA 区域的大小
3. 通过设备树源文件的节点 `/reserved-memory` 配置 CMA 区域，如果子节点的属性 `compatible` 的值是 `shared-dma-pool`，表示全局 CMA 区域，否则表示设备私有 CMA 区域。

CMA 相关内核参数：

```txt
	cma=nn[MG]@[start[MG][-end[MG]]]
			[KNL,CMA,EARLY]
			Sets the size of kernel global memory area for
			contiguous memory allocations and optionally the
			placement constraint by the physical address range of
			memory allocations. A value of 0 disables CMA
			altogether. For more information, see
			kernel/dma/contiguous.c

	cma_pernuma=nn[MG]
			[KNL,CMA,EARLY]
			Sets the size of kernel per-numa memory area for
			contiguous memory allocations. A value of 0 disables
			per-numa CMA altogether. And If this option is not
			specified, the default value is 0.
			With per-numa CMA enabled, DMA users on node nid will
			first try to allocate buffer from the pernuma area
			which is located in node nid, if the allocation fails,
			they will fallback to the global default memory area.

	numa_cma=<node>:nn[MG][,<node>:nn[MG]]
			[KNL,CMA,EARLY]
			Sets the size of kernel numa memory area for
			contiguous memory allocations. It will reserve CMA
			area for the specified node.

			With numa CMA enabled, DMA users on node nid will
			first try to allocate buffer from the numa area
			which is located in node nid, if the allocation fails,
			they will fallback to the global default memory area.

```

初始化分为以下 3 步

```cpp
/* 1. 内核参数解析：CMA 区域的大小等等 */
static int __init early_cma(char *p)
{
	if (!p) {
		pr_err("Config string not provided\n");
		return -EINVAL;
	}

	size_cmdline = memparse(p, &p);
	if (*p != '@')
		return 0;
	base_cmdline = memparse(p + 1, &p);
	if (*p != '-') {
		limit_cmdline = base_cmdline + size_cmdline;
		return 0;
	}
	limit_cmdline = memparse(p + 1, &p);

	return 0;
}
early_param("cma", early_cma);

/* 2. 使用 memblock 内存分配器为 CMA 分配内存，即，为 CMA 预留内存。
   注意，如果用某个指定的范围的内存创建 CMA，但这个范围中的一部分内存已经被
   memblock 分配出去了，那么就会创建失败 */
start_kernel->setup_arch
  dma_contiguous_reserve(max_pfn_mapped << PAGE_SHIFT);
    dma_contiguous_reserve_area()
      cma_declare_contiguous()->cma_declare_contiguous_nid()
        /* 进行 reserve，本质上就相当于是 memblock 将这段物理内存分配出去 */
        memblock_reserve(base, size)
        /* 记录在 struct cma cma_areas[MAX_CMA_AREAS]; 数组中 */
        cma_init_reserved_mem()
          cma = &cma_areas[cma_area_count];
          cma->base_pfn = PFN_DOWN(base);
          cma->count = size >> PAGE_SHIFT;
          cma->order_per_bit = order_per_bit;
          cma_area_count++;

/* 3. 在 1 号进程执行 initcall，将 CMA 区域的物理页释放给 buddy system */
core_initcall(cma_init_reserved_areas);
  for (i = 0; i < cma_area_count; i++)
    cma_activate_area(&cma_areas[i]);
      /* 每次初始化 pageblock_nr_pages 个页面 */
      init_cma_reserved_pageblock()
        /* 标记 pageblock 的迁移类型为 MIGRATE_CMA */
        set_pageblock_migratetype(page, MIGRATE_CMA);
        /* 将 pageblock 释放给 buddy system，会被放到 MIGRATE_CMA 链表里 */
        __free_pages(page, pageblock_order);
```

初始化过程总结：

1. 解析内核参数，确定好 CMA 区域的大小和范围
2. 通过 memblock 为 CMA 区域分配物理内存
3. 将 pageblock 标记为 MIGRATE_CMA 迁移类型，再释放给 buddy system

## 内核的其他模块从 CMA 区域借用页

当设备驱动程序不使用 CMA 区域的时候，内核的其他模块可以借用 CMA 区域的物理页，页分配器只允许可移动类型从 CMA 类型借用物理页。

这里只介绍从 CMA 区域分配内存，整体的内存分配流程详见 [Buddy System 伙伴系统: Linux 物理内存分配](./buddy.md)

分配页面时，如果 gfp flags 带 `__GFP_MOVABLE`，那么：

1. `gfp_migratetype()` 返回值带有 `MIGRATE_MOVABLE`
2. `gfp_to_alloc_flags_cma()` 返回的 alloc_flags 带有 `ALLOC_CMA`，就意味着允许分配的页面被移动，也即，分配的页面可以来自于 CMA 区域。

用户空间的内存需求一般都带 `__GFP_MOVABLE` 的，以一个匿名页 pagefault 为用户进程分配页面的流程为例：

```cpp
#define GFP_HIGHUSER_MOVABLE	(GFP_HIGHUSER | __GFP_MOVABLE | __GFP_SKIP_KASAN)

handle_page_fault()->do_user_addr_fault()->...->do_anonymous_page()
  alloc_anon_folio()->folio_prealloc()->vma_alloc_folio_noprof(GFP_HIGHUSER_MOVABLE, )
    folio_alloc_mpol_noprof()->alloc_pages_mpol_noprof()->__alloc_pages_noprof()
      get_page_from_freelist()->rmqueue()->rmqueue_buddy()->__rmqueue()
        /* 经过一系列的调用，来到这里 */
        __rmqueue_cma_fallback(zone, order);
          __rmqueue_smallest(zone, order, MIGRATE_CMA)
            /* 从 zone->free_area[order]->free_list[MIGRATE_CMA] 空闲页面链表里取出页面 */
            area = &(zone->free_area[current_order]);
            page = get_page_from_free_area(area, migratetype);
```

`migratetype` 是同一个 pageblock 内的页面的属性。

- [ ] 没太搞懂，空闲页面被放到 buddy system 时，是怎么决定放到哪个 migratetype 的 freelist 上的？
      我只理解 `MIGRATE_CMA` 需要放到单独的链表上，当为什么其他类型的不能放在同一个链表上？

注意，`MIGRATE_CMA` 和 `MIGRATE_MOVABLE` 是有区别的，
前者只能分配的页面必须可以被移动；后者实际上可以被窃取被用于分配不可被移动的页面？

## 设备驱动从 CMA 区域分配内存

当设备驱动程序需要使用 CMA 区域的时候，如果 CMA 区域中的物理页已经被页分配器分配出去，需要把物理页迁移到其他地方。

或者是初始化 dma pool 时，

```cpp
dma_atomic_pool_init()->__dma_atomic_pool_init()->atomic_pool_expand()
  dma_alloc_from_contiguous()->cma_alloc()->__cma_alloc()
```

或者是 dma-buf 分配 buffer 时

```cpp
dma_heap_buffer_alloc()
  ops->allocate:cma_heap_allocate()->cma_alloc()
```

讲述下流程：

1. 在 cma.c 这一层，通过在位图中查找，来找到一块连续的未被分配的区域
2. 调用 `alloc_contig_range_noprof()` 函数，从 buddy system 中分配指定的这块区域。
   1. 参数约束：指定的范围内的 pageblock，必须是相同类型，并且要么是 MIGRATE_MOVABLE 要么是 MIGRATE_CMA

```cpp
__cma_alloc()
  /* 通过在位图中查找空闲区域，确认要分配的连续物理页面范围 */
  /* 从 buddy system 中拿出这部分连续物理页面。 */
  alloc_contig_range_noprof(pfn, pfn + count, MIGRATE_CMA, gfp)
    /* 该范围内的物理页面，可能不在 MIGRATE_CMA 已经被借用走了，比如被用于作为用户进程的私有匿名页，
    因此需要进行迁移 */
    /* 把物理页的迁移类型设置为隔离类型 MIGRATE_ISOLATE 隔离物理页，防止页分配器把空闲页分配出去 */
    start_isolate_page_range()
    /* 将所在 zone 内的 pcp list 里的页面都还回到 buddy system */
    drain_all_pages()
    /* 处理已经被 buddy system 分配出去的物理页 */
    __alloc_contig_migrate_range()
      /* 回收干净的页，文件页不可移动，只可回收//XXX 这是为什么 */
      reclaim_clean_pages_from_list()
      /* 将可移动的页迁移到其他地方 */
      migrate_pages()
    /* 处理空闲页，把空闲页从 buddy system 中删除 */
    isolate_freepages_range()
    /* 撤销 MIGRATE_ISOLATE 改为 MIGRATE_CMA */
    undo_isolate_page_range()
```

## 设备驱动释放 CMA 区域的内存

```cpp
cma_release()
  /* 检查页面是否属于 CMA 区域 */
  if (!cma_pages_valid()) return false;
  /* 将页面释放给 buddy system */
  free_contig_range()
  /* 在 CMA 区域的位图中，把页的分配状态设置为空闲 */
  cma_clear_bitmap()
```

## /sys/kernel/mm/cma/

```bash
~ # ls /sys/kernel/mm/cma/reserved/
alloc_pages_fail       alloc_pages_success    release_pages_success
```

## 一些碎碎念

### cma: Failed to reserve 1024 MiB on node -1

使用参数 `cma=1G@5G` 时，会让内核将 [5G, 6G) 作为 CMA 区域，但是我发现失败了，报错 cma: Failed to reserve 1024 MiB on node -1

加上 `memblock=debug` 参数，找到了原因

```log
用 memblock 在 [5G, 6G) 区域内分配了一小块内存
[    0.005676] memblock_reserve: [0x000000017ffd5300-0x000000017fffffff] memblock_alloc_range_nid+0x9b/0x1b0
[    0.005678] NODE_DATA(0) allocated [mem 0x17ffd5300-0x17fffffff]
[    0.005885] memblock_reserve: [0x000000027ffd3300-0x000000027fffdfff] memblock_alloc_range_nid+0x9b/0x1b0
[    0.005887] NODE_DATA(1) allocated [mem 0x27ffd3300-0x27fffdfff]
[    0.005899] MEMBLOCK configuration:
[    0.005900]  memory size = 0x00000001fff7ec00 reserved size = 0x0000000004a32419
[    0.005901]  memory.cnt  = 0x4
[    0.005902]  memory[0x0]     [0x0000000000001000-0x000000000009efff], 0x000000000009e000 bytes on node 0 flags: 0x0
[    0.005905]  memory[0x1]     [0x0000000000100000-0x000000007ffdffff], 0x000000007fee0000 bytes on node 0 flags: 0x0
[    0.005906]  memory[0x2]     [0x0000000100000000-0x000000017fffffff], 0x0000000080000000 bytes on node 0 flags: 0x0
[    0.005908]  memory[0x3]     [0x0000000180000000-0x000000027fffffff], 0x0000000100000000 bytes on node 1 flags: 0x0
[    0.005909]  reserved.cnt  = 0x8
[    0.005909]  reserved[0x0]   [0x0000000000000000-0x0000000000000fff], 0x0000000000001000 bytes flags: 0x0
[    0.005911]  reserved[0x1]   [0x0000000000001000-0x00000000000fffff], 0x00000000000ff000 bytes on node 0 flags: 0x0
[    0.005912]  reserved[0x2]   [0x0000000001000000-0x0000000004808fff], 0x0000000003809000 bytes on node 0 flags: 0x0
[    0.005914]  reserved[0x3]   [0x000000007ef09000-0x000000007ffd7fff], 0x00000000010cf000 bytes on node 0 flags: 0x0
[    0.005915]  reserved[0x4]   [0x000000007ffe0000-0x000000007ffe2a18], 0x0000000000002a19 bytes on node 0 flags: 0x0
[    0.005916]  reserved[0x5]   [0x000000017ffd5300-0x000000017fffffff], 0x000000000002ad00 bytes flags: 0x0
[    0.005917]  reserved[0x6]   [0x000000027ffd3300-0x000000027fffdfff], 0x000000000002ad00 bytes flags: 0x0
[    0.005919]  reserved[0x7]   [0x000000027fffe000-0x000000027fffffff], 0x0000000000002000 bytes on node 1 flags: 0x0
此时用 memblock 申请 [5G, 6G) 这块内存，会失败
[    0.006042] cma: Failed to reserve 1024 MiB on node -1
```

因此，不建议用这种写法，而是直接 `cma=1G` ？

### 在某些情况下 cma 指定不了范围？

使用 `cma=1G@6G-8G` 参数，结果发现 CMA 区域是 [4G, 5G)，并不在 [6G, 8G) 的范围内。

```log
[    0.006569] cma: Reserved 1024 MiB at 0x0000000100000000 on node -1
```

和这个 patch 有关：
[\[PATCH v2 1/2\] mm: cma: allocate cma areas bottom-up - Roman Gushchin](https://lore.kernel.org/all/20201217201214.3414100-1-guro@fb.com/)
