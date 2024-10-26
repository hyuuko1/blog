# SLUB 内存分配器

## 参考

按顺序看完这 4 篇（实际上讲的都是 slub），我写的基本就不用看了（

1. [细节拉满，80 张图带你一步一步推演 slab 内存池的设计与实现 - 知乎](https://zhuanlan.zhihu.com/p/619560125)
2. [从内核源码看 slab 内存池的创建初始化流程 - 知乎](https://zhuanlan.zhihu.com/p/621239181)
3. [深入理解 slab cache 内存分配全链路实现 - 知乎](https://zhuanlan.zhihu.com/p/626883293)
4. [深度解析 slab 内存池回收内存以及销毁全流程 - 知乎](https://zhuanlan.zhihu.com/p/632323986)

其他

- [SLUB DEBUG 原理](http://www.wowotech.net/memory_management/427.html)

## 概览

- SLAB (已废弃)
- SLOB (Simple List Of Blocks, 已废弃) 适用于小内存的嵌入式设备。
  从这个 [\[PATCH 00/12\] Introduce CONFIG_SLUB_TINY and deprecate SLOB - Vlastimil Babka](https://lore.kernel.org/lkml/20221121171202.22080-1-vbabka@suse.cz/) 开始弃用了 SLOB，并为小内存场景引入了 `CONFIG_SLUB_TINY`。
- SLUB 适用于大内存
  [\[PATCH\] mm: remove all the slab allocators - Vlastimil Babka](https://lore.kernel.org/linux-mm/20230401094658.11146-1-vbabka@suse.cz/) 在 20230401 尝试废弃（

slab 内存池的使用场景：分配和释放小内存，比如一些数据结构对象。

slab 首先会向伙伴系统一次性申请一个或者多个物理内存页面，正是这些物理内存页组成了 slab 内存池。

随后 slab 内存池会将这些连续的物理内存页面划分成多个大小相同的小内存块出来，同一种 slab 内存池下，划分出来的小内存块尺寸是一样的。内核会针对不同尺寸的小内存分配需求，预先创建出多个 slab 内存池出来。分配或释放对象时，直接从相应的 slab 内存池申请或释放，避免了链路比较长的内存分配与释放过程，极大地提升了性能。

1. 解决内碎片问题。
2. 利用局部性。slab 会优先分配之前刚释放的对象。该对象可能还在 cpu cache 里。
3. 伙伴系统的调用链路长，相关的指令和数据会将一些频繁使用的指令和数据从 L1Cache 挤出去。slab 对象池调用链路短，L1Cache 污染小。

SLAB 分配器的核心思想是：为每种对象类型创建一个内存缓存 `struct kmem_cache`，每个内存缓存由多个大块组成，一个大块是一个或多个连续的物理页。

为了方便使用，块分配器在初始化的时候创建了一些通用的内存缓存，对象的长度大多数是 2^n 字节，从 normal zone 分配的内存缓存的名称是 `kmalloc-<size>`，从 DMA zone 分配内存缓存的名称是 `dma-kmalloc-<size>`，执行命令`cat /proc/slabinfo` 可以看到这些通用的内存缓存。

使用通用的内存缓存的缺点是：块分配器需要找到一个对象的长度刚好大于或等于请求的内存长度的通用内存缓存，如果请求的内存长度和内存缓存的对象长度相差很远，浪费比较大，例如申请 36 字节，实际分配的内存长度是 64 字节，浪费了 28 字节。所以有时候使用者需要创建专用的内存缓存。

```cpp
void *kmalloc(size_t size, gfp_t flags)
void kfree(const void *objp);

struct kmem_cache *kmem_cache_create(const char *name, unsigned int size, unsigned int align, slab_flags_t flags, void (*ctor)(void *))
void *kmem_cache_alloc(struct kmem_cache *cachep, gfp_t flags)
void kmem_cache_free(struct kmem_cache *s, void *objp);
void kmem_cache_destroy(struct kmem_cache *s);
int kmem_cache_shrink(struct kmem_cache *s);
```

### 用户态接口和命令

`/proc/slabinfo`

- statistics 是基本统计信息
  - active_objs 表示 slab cache 中已经被分配出去的对象个数
  - num_objs 表示 slab cache 中容纳的对象总数
  - objsize 表示对象的 object size ，单位为字节
  - objperslab 表示每个 slab 可以容纳的对象个数
  - pagesperslab 表示每个 slab 所需要的物理内存页个数
- tunables 是动态可调节参数。与 slub 没关系。
  - limit 表示在 slab 的实现中，slab cache 的 cpu 本地缓存 array_cache 最大可以容纳的对象个数
  - batchcount 表示当 array_cache 中缓存的对象不够时，需要一次性填充的空闲对象个数。
- slabdata 是总体信息
  - active_slabs 一列展示的 slab cache 中活跃的 slab 个数。
  - nums_slabs 一列展示的是 slab cache 中管理的 slab 总数

`/proc/meminfo` 的 Slab 一行，是 slab cache 占用的内存总量。

`slabtop` 命令

## 数据结构

```cpp
struct kmem_cache {
	/* percpu slab 缓存 */
	struct kmem_cache_cpu __percpu *cpu_slab;

	/* 用于设置 slab 的一些特性，比如：按照什么方式对齐，是否需要毒化等 */
	slab_flags_t flags;
	unsigned long min_partial;
	unsigned int size;		/* 对象真实大小，包含 read zone 等填充区域 */
	unsigned int object_size;	/* 对象原始大小，不包含填充区域 */
	struct reciprocal_value reciprocal_size;
	unsigned int offset;		/* freepointer 在对象中的偏移 */

	/* Number of per cpu partial objects to keep around */
	unsigned int cpu_partial;
	/* Number of per cpu partial slabs to keep around */
	unsigned int cpu_partial_slabs;

	/* 最优的阶数和对象数。高 16 位是物理页面阶数，低 16 位是能容纳的对象数。
	   最优是指：slab 使用 oo>>16 个物理页面时，剩余没用到的空间最小，利用率最大 */
	struct kmem_cache_order_objects oo;
	/* slab 最少需要的物理页面的阶数，以及能容纳的对象数。内核最开始，
	   会按照 oo 的阶数来向伙伴系统申请物理页面，长时间运行以后，内存碎片化，
	   分配连续页很难成功，就会按 min 的阶数来申请，申请到的页面能容纳一个对象即可 */
	struct kmem_cache_order_objects min;
	gfp_t allocflags;		/* 每次分配物理页面时用的 flag */
	int refcount;			/* Refcount for slab cache destroy */
	void (*ctor)(void *object);	/* 对象的构造函数 */
	/* object_size 按照 word size 对齐之后的大小，
	   如果我们设置了SLAB_RED_ZONE，也会包括对象右侧 red zone 区域的大小 */
	unsigned int inuse;		/* Offset to metadata */
	unsigned int align;		/* Alignment */
	unsigned int red_left_pad;	/* 左侧 redzone 大小 */
	const char *name;		/* /proc/slabinfo 的 name 那一列 */
	struct list_head list;		/* 作为链表成员，挂在链表 slab_caches 上 */

	struct kobject kobj;		/* For sysfs */

	/*
	 * Defragmentation by allocating from a remote node.
	 */
	unsigned int remote_node_defrag_ratio;

	/* 所有 node 的对象链表 */
	struct kmem_cache_node *node[MAX_NUMNODES];
};

/* percpu slab 缓存 */
struct kmem_cache_cpu {
	union {
		struct {
			void **freelist;	/* 下一个可用 object 的地址，
						   同时也是该 object 内的 freelist 指针的地址？ */
			unsigned long tid;	/* 可以看作是 cpu 的 id */
		};
		freelist_aba_t freelist_tid;
	};
	struct slab *slab;	/* 我们正在从这个 slab 进行分配 */
	struct slab *partial;	/* 一个 slab 链表，存放着“部分空闲”的 slab */
	local_lock_t lock;	/* Protects the fields above */
};

/* per node */
struct kmem_cache_node {
	spinlock_t list_lock;
	unsigned long nr_partial;	/* 部分空闲 slab 的数量 */
	struct list_head partial;	/* 部分空闲的 slab */
#ifdef CONFIG_SLUB_DEBUG
	atomic_long_t nr_slabs;		/* slab 数量 */
	atomic_long_t total_objects;	/* 对象总数 */
	struct list_head full;		/*  */
#endif
};

/* slab 由 2^n 个连续物理页组成。如果 n>0 则是一个复合页。
   struct slab 是从 struct page 中剥离出来的。
   https://lore.kernel.org/linux-mm/20211004134650.4031813-1-willy@infradead.org/ */
struct slab {
	/*  */
	unsigned long __page_flags;

	struct kmem_cache *slab_cache;
	union {
		struct {
			union {
				/* 作为链表成员，挂在 kmem_cache_node 上？ */
				struct list_head slab_list;
				/* 作为 kmem_cache_cpu 单向链表成员？ */
				struct {
					struct slab *next;
					int slabs;	/* Nr of slabs left */
				};
			};
			/* Double-word boundary */
			union {
				struct {
					/* 指向第一个空闲对象。当 slab 放进 kmem_cache_cpu 中时，
					会赋值给 kmem_cache_cpu->freelist。然后该 freelist 被置 0 */
					void *freelist;
					union {
						unsigned long counters;
						struct {
						/* 已分配对象的数量 */
							unsigned inuse:16;
						/* 对象的数量 */
							unsigned objects:15;
						/* 如果在 percpu slab 缓存中，标记为冻结状态。
						反之，处于 kmem_cache_node 的 partial 链表中 */
							unsigned frozen:1;
						};
					};
				};
				freelist_aba_t freelist_counter;
			};
		};
		/* 在创建内存缓存的时候，如果指定标志位 SLAB_TYPESAFE_BY_RCU，要求使用 RCU 延迟释放 slab，
		在调用函数 call_rcu 把释放 slab 的函数加入 RCU 回调函数队列的时候，需要 rcu_head。
		*/
		struct rcu_head rcu_head;
	};

	unsigned int __page_type;
	atomic_t __page_refcount;
	unsigned long obj_exts;
};
```

1. `kmem_cache_create()` 为特定大小的对象创建一个 `struct kmem_cache`
2. 一个 `struct kmem_cache` 管理着许多 `struct slab`。通过 `struct kmem_cache_node` 和 `struct kmem_cache_cpu` 来管理。
3. 一个 `struct slab` 描述了 2^n 个连续物理页。存储着许多 object。
   乍一看，“描述了 2^n 个连续物理页”，这不就是起到了 struct page 或 compound page 的作用吗？实际上，在 v5.17 之前的内核，就是用 `struct page` 来管理这些 object，现在的 `struct slab` 就是从 `struct page` 中剥离出的。

SLUB 分配器在创建内存缓存的时候计算了两种 slab 长度：最优 slab 和最小 slab。最优 slab 是剩余部分比例最小的 slab，最小 slab 只需要足够存放一个对象。当设备长时间运行以后，内存碎片化，分配连续物理页很难成功，如果分配最优 slab 失败，就分配最小 slab。

每个 slab 由一个或多个连续的物理页组成，页的阶数是最优 slab 或最小 slab 的阶数，如果阶数大于 0，组成一个复合页。

分配流程简述：

1. 先从 percpu slab 缓存分配，如果当前有一个 slab 正在使用，并且有空闲对象，则分配。
2. 否则，如果 percpu 的 partial 部分空闲链表不是空的，则取出第一个 slab，作为当前正在使用的 slab。
3. 如果 partial 是空的。从当前 node 的的部分空闲链表取出 slab，重填 per cpu 的部分空闲 slab 链表。
4. 如果当前 node 的部分空闲链表也是空的，则分配新的 slab。注意并不会从其他 node 拿。

`kmem_cache` 实例的成员 `remote_node_defrag_ratio` 称为远程节点反碎片比例，用来控制从远程节点借用部分空闲 slab 和从本地节点取部分空闲 slab 的比例，值越小，从本地节点取部分空闲 slab 的倾向越大。默认值是 1000，可以通过文件 `/sys/kernel/slab/<内存缓存名称>/remote_node_defrag_ratio` 设置某个内存缓存的远程节点反碎片比例，用户设置的范围是 [0, 100]，内存缓存保存的比例值是乘以 10 以后的值。

释放对象：

1. 如果释放对象时，发现，当前对象所属的 slab 之前没有空闲对象（也就是说，释放当前对象，会使得该 slab 成为部分空闲 slab），并且，没有 frozen 在 percpu slab 缓存中，就会把该 slab 放在当前 cpu 的部分空闲 slab 链表中。
2. 如果该链表总数超过限制 `kmem_cache.cpu_partial`，则将链表中的所有 slab 归还到当前 node 的部分空闲 slab 链表中。

这种做法的好处是：把空闲对象非常少的 slab 放在每处理器空闲 slab 链表中，优先从空闲对象非常少的 slab 分配对象，减少内存浪费。

### 对 slab 的管理

不同状态的 slab，会在 slab cache 中被不同的链表所管理，同时 slab cache 会控制管理链表中 slab 的个数以及链表中所缓存的空闲对象个数，防止它们无限制的增长。

- empty slab
- partial slab
- full slab

### slab 内部，对 object 的管理

word size 对齐，在 x86_64 就是 8 字节。

为了应对内存读写越界的场景，于是在对象内存的周围插入了一段不可访问的内存区域，这些内存区域用特定的字节 0xbb 填充，当进程访问的到内存是 0xbb 时，表示已经越界访问了。这段内存区域在 slab 中的术语为 red zone，大家可以理解为红色警戒区域。

空闲对象用链表串起来。

### `CONFIG_SLUB_DEBUG`

SLAB_POISON，毒化 slab，在对象内存区域填充特定字节表示对象的特殊状态的行为

在 5.17 版本之前的内核中，都是以一个 struct page 结构来表示一个 slab，如果 slab 用的是多个物理页，那则使用 compound page 来表示 slab。
5.17 版本，考虑到 struct page 已经非常庞大复杂，将 slab 相关字段删除，转移到 struct slab。

```cpp
/* DEBUG: Perform (expensive) checks on alloc/free */
#define SLAB_CONSISTENCY_CHECKS	__SLAB_FLAG_BIT(_SLAB_CONSISTENCY_CHECKS)
/* DEBUG: Red zone objs in a cache */
#define SLAB_RED_ZONE		__SLAB_FLAG_BIT(_SLAB_RED_ZONE)
/* DEBUG: Poison objects */
#define SLAB_POISON		__SLAB_FLAG_BIT(_SLAB_POISON)
/* DEBUG: Store the last owner for bug hunting */
#define SLAB_STORE_USER		__SLAB_FLAG_BIT(_SLAB_STORE_USER)
/* Trace allocations and frees */
#define SLAB_TRACE		__SLAB_FLAG_BIT(_SLAB_TRACE)

#ifdef CONFIG_SLUB_DEBUG
#define SLAB_DEBUG_FLAGS (SLAB_RED_ZONE | SLAB_POISON | SLAB_STORE_USER | \
			  SLAB_TRACE | SLAB_CONSISTENCY_CHECKS)
#else
#define SLAB_DEBUG_FLAGS (0)
#endif
```

- [ ] `CONFIG_SLUB_DEBUG_ON`

## 代码分析

### 初始化

### 分配对象

### 释放对象
