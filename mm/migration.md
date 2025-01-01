# 页面迁移

- [【原创】（五）Linux 内存管理 zone_sizes_init - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11568481.html)
- 《Linux 内核深度解析》3.7.3 根据可移动性分组。

```cpp
/* 9 */
#define pageblock_order		MIN_T(unsigned int, HUGETLB_PAGE_ORDER, MAX_PAGE_ORDER)
/* 512 */
#define pageblock_nr_pages	(1UL << pageblock_order)
```

在系统长时间运行后，物理内存可能出现很多碎片，可用物理页很多，但是最大的连续物理内存可能只有一页。内存碎片对用户程序不是问题，因为用户程序可以通过页表把连续的虚拟页映射到不连续的物理页。但是内存碎片对内核是一个问题，因为内核使用直接映射的虚拟地址空间，连续的虚拟页必须映射到连续的物理页。

为了预防内存碎片，内核根据可移动性把物理页分为 3 种类型。

1. 不可移动页：位置必须固定，不能移动，直接映射到内核虚拟地址空间的页，比如 kmalloc 申请的页面，属于这一类。
2. 可移动页：使用页表映射的页属于这一类，可以移动到其他位置，然后修改页表映射。
3. 可回收页：不能移动，但可以回收，需要数据的时候可以重新从数据源获取。后备存储设备支持的页属于这一类。

内核把具有相同可移动性的页分组。为什么这种方法可以减少碎片？试想：如果不可移动页出现在可移动内存区域的中间，会阻止可移动内存区域合并。这种方法把不可移动页聚集在一起，可以防止不可移动页出现在可移动内存区域的中间。

```cpp
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

前面 3 种是真正的迁移类型，后面的迁移类型都有特殊用途： MIGRATE_HIGHATOMIC 用于高阶原子分配，MIGRATE_CMA 用于连续内存分配器，MIGRATE_ISOLATE 用来隔离物理页（由连续内存分配器、内存热插拔和从内存硬件错误恢复等功能使用）。

pageblock_order 是按可移动性分组的阶数，简称分组阶数，可以理解为一种迁移类型的一个页块的最小长度。如果内核支持巨型页，那么 pageblock_order 是巨型页的阶数，否则 pageblock_order 是伙伴分配器的最大分配阶。

TODO 疑问：为啥会有 pageblock 这种东西。

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

内核在初始化时，把所有页块初始化为可移动类型，其他迁移类型的页是盗用产生的。

```cpp
memmap_init_zone_range()
  memmap_init_range(, MIGRATE_MOVABLE)
```

```bash
# 查看各种迁移类型的页的分布情况
$ cat /proc/pagetypeinfo
```
