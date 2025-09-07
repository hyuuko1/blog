# struct page/folio 详解

## 参考

按照顺序把下列文章看完，本文就不用看了。

- https://lwn.net/Kernel/Index/#Memory_management-Folios
- [论好名字的重要性： Linux 内核 page 到 folio 的变迁 - OPPO 内核工匠](https://blog.csdn.net/feelabclihu/article/details/131485936)
- [Linux Large Folios 大页在社区和产品的现状和未来 - OPPO 内核工匠](https://blog.csdn.net/feelabclihu/article/details/137983188)
  - large folio 带来的改进
- [page 到 folio 的变迁 - 知乎](https://zhuanlan.zhihu.com/p/1902473318315058208)
- [Linux Compound Page - 知乎](https://zhuanlan.zhihu.com/p/1893129934966334162)
  - Compound page 在文件页中为什么没有大量应用
- [Linux folios - 知乎](https://zhuanlan.zhihu.com/p/1899608337592587983)
- [Linux 内存管理新特性 - Memory folios 解读 - 知乎](https://zhuanlan.zhihu.com/p/654873809)
- [代码段使用 large folio（LSFMM&BPF 2025） - 知乎](https://zhuanlan.zhihu.com/p/1893423269048217950)
- https://www.infradead.org/~willy/linux/2022-06_LCNA_Folios.pdf
- https://lore.kernel.org/linux-mm/20220104001046.12263-1-vbabka@suse.cz/
- https://lore.kernel.org/all/20210712190204.80979-1-willy@infradead.org/
- [\[PATCH 00/28\] mm, swap: introduce swap table - Kairui Song](https://lore.kernel.org/lkml/20250514201729.48420-1-ryncsn@gmail.com/)

mTHP 相关：

- [mthp](./mthp.md)

后续路线

- [MatthewWilcox/Memdescs/Path - Linux Kernel Newbies](https://kernelnewbies.org/MatthewWilcox/Memdescs/Path)
- [MatthewWilcox/BuddyAllocator - Linux Kernel Newbies](https://kernelnewbies.org/MatthewWilcox/BuddyAllocator)
  - [\[Chapter One\] THP zones: the use cases of policy zones - Yu Zhao](https://lore.kernel.org/linux-mm/20240229183436.4110845-2-yuzhao@google.com/)

这些文章介绍的已经很详尽了，我只做一些总结。

## 要解决什么问题？

先直接说结论：**folio 必然不可能是一个 tail page**，而是一个集体概念（单个也算集体），避免了语义混乱。带来了以下好处：

- 降低 compound_head 冗余的调用导致的性能衰退
- folio 无论是否为 compound page 均为 head page，修复可能出现的误将 tail page 当作 head page 来使用导致的 bug
- 更容易实现 page cache 文件页 larg folio，提升性能
- 匿名页 pagefault 更容易实现 mTHP，减少 cache miss 和 pagefault 次数。
- arm64 更容易实现 cont pte
- 提升 swap-out swap-in 性能
- 潜在的以更大粒度在 zRAM/zsmalloc 进行压缩/解压的机会，从而降低压缩/解压的 CPU 利用率、提高压缩率。比如 64KiB 的 large folio 整体压缩，比分成 16 个 4KiB 的 small folio 来进行压缩，有明显优势。
- 随着 struct page 成员不断地剥离，未来可能不再需要 64 字节，folio、ptdesc、slab 这些结构体转为动态分配
- 降低 LRU 的规模和内存 reclamation 的成本，以 large folio 为单位进行回收，整个 large folio 在 folio_referenced() 等的反向映射成本低于多个 small folio 单独进行 rmap 的成本；try_to_unmap_one() 理论上也如此。

**先理解 compound page 是什么？满足以下条件的连续页，PageCompound() 返回 true，order>0**

- 首页 head page 有 PG_head 标记 `page->flags |= (1UL << PG_head);`
- 其他的页 tail page 的 compound_head 上的最后一位设置 1 `page->compound_head |=  1UL;`，compound_head-1 指向真正的 head page。

head page 和 tail page 都被称为 compound page。

5.10 版本的 API：

```cpp
/* 判断是否是 compound page */
static __always_inline int PageCompound(struct page *page)
{
	/* head page 或 tail page */
	return test_bit(PG_head, &page->flags) || PageTail(page);
}

/* 判断是否是 head page of compound（其实是个宏，这里我改成函数了） */
static __always_inline int PageHead(const struct page *page)
{
	return test_bit(PG_head, &page->flags);
}

/* 判断是否是 tail page of compound */
static __always_inline int PageTail(struct page *page)
{
	return READ_ONCE(page->compound_head) & 1;
}

/* 传入 head page，从 page[1] 得到复合页大小 */
static inline unsigned int compound_order(struct page *page)
{
	if (!PageHead(page))
		return 0;
	return page[1].compound_order;
}

/* 得到 head page */
static inline struct page *compound_head(struct page *page)
{
	unsigned long head = READ_ONCE(page->compound_head);
	/* 如果是 tail page，那 compound_head-1 就是 head page */
	if (unlikely(head & 1))
		return (struct page *) (head - 1);
	return page;
}

void prep_compound_page(struct page *page, unsigned int order)
```

Linux 内核中，有使用 compound page 的地方：

1. 一些驱动通过 `__GFP_COMP` 申请 order>0 的连续页，比如 `alloc_skb_with_frags()`
2. 透明大页（THP）和 HugeTLB 大页。

HugeTLB 和 THP 场景不可能是只有 2 页，它们存在 2MB/4KB，所以一定存在 page[2]。

通过 page[0]~page[n-1] 中 flags、compound_head、compound_dtor 成员的特殊串联关系，把这 N 个 page 结构体联系在了一起。这产生了一个混乱，很多时候，我们真正想操作的，其实只是 compound page 的**整体**，比如 get_page()、put_page()、lock_page()、unlock_page() 等。于是这样的 API 里面，广泛地存在这样的 `compound_head()` 操作用于获取 head page。

就以 get_page() 为例，传入 get_page() 的 page 结构体，其实可能是三种情况：

1. 就是一个普通的非 compound page 的 4KB page，这个时候，`compound_head()` API 实际还是返回那个 page；
2. 传入的是一个 compound page 的 page[0]（也即 head page），这个时候，`compound_head()` 返回的还是 page[0]；
3. 传入的是 compound page 的 page[1]~page[n]（也即 tail page），这个时候，`compound_head()` 返回的是 compound_head-1，也就是 page[0]。

## 如何解决问题的？

struct folio 表达一块连续的大小为 2^order (order>=0) 的物理页面。

- order=0 时，表达一个“独立”的页面，称之为 small folio
- order>0 时，表达复合页，称之为 large folio
- 无法表达复合页内的 tail page，此时仍需 struct page 来表达。

也就是说，**folio 必然不可能是一个 tail page**，而是一个集体概念（单个也算集体），避免了语义混乱，这就是 folio 的核心所在，可以省去 `compound_head()`

Linux 中使用页面集合的例子：

1. 加入 lruvec 的页面集合。
2. refcount 计数、进行 lock
3. mem_cgroup 等的记账 charge
4. wait writeback、bit
5. address_space 绑定的 Page cache 的查找、插入、删除等操作应该是一个集合，因为 page cache 也是可以是 THP 的。
6. rmap 相关的单元应该是一个集合。

本质上 folio 和 page 数据结构在内存意义上相等，所以基于历史原因短期内难以改掉的代码，使用的仍然是 page。
为了方便，把一些 page 里面常用字段，放在了 folio 里的相同位置。

folio_page(folio, n)这个 API 可以取出一个 folio 中的第 n 个 page。

目前 6.16 对 `struct page` 进行拆分出了 6 个结构体，不仅仅是 folio，还有 slab 等等。

- `struct folio` 复合页
- `struct slab`
- `struct ptdesc` 页表
- `struct zpdesc` 用于 zswap mm/zpdesc.h
- `struct ioptdesc` 用于 iommu drivers/iommu/iommu-pages.h
- `struct net_iov`
  把 sk_buff 的 head 指向的 folio 转为 netmem_ref 的过程：skb_head_frag_to_page_desc()->skb_frag_fill_page_desc()->page_to_netmem()。
  再转为 net_iov：netmem_to_net_iov()

其他差异

- 原先的 page_mapped() 需遍历复合页内每个 page，如今用 folio 描述整个复合页，从 `_mapcount` 可以明确整个复合页的状态。

## folio

## 后续路线

让 struct page 只有 8byte 指向通过 slab 来动态分配 folio、ptdesc、slab 的，这样更省内存。
毕竟 2MB 大页实际上只需要 3 个 struct page。

## struct page

- _The Linux Memory Manager_ 2.1 struct page
- [ ] 对比 5.10 和 6.16 版本的，分析 page 剩余的字段。

```cpp
struct page {
	unsigned long flags;

	union {
		/* Page cache and anonymous pages */
		struct {
			union {
				struct list_head lru;

				/* Or, for the Unevictable "LRU list" slot */
				struct {
					/* Always even, to negate PageTail */
					void *__filler;
					/* Count page's or folio's mlocks */
					unsigned int mlock_count;
				};

				/* Or, free page */
				struct list_head buddy_list;
				struct list_head pcp_list;
			};
			/* See page-flags.h for PAGE_MAPPING_FLAGS */
			struct address_space *mapping;
			union {
				pgoff_t index;		/* Our offset within mapping. */
				unsigned long share;	/* share count for fsdax */
			};

			unsigned long private;
		};


		struct rcu_head rcu_head;
	};

	union {
		/* 如果是 folio 的 head page（如果是空闲的，那也可以说是buddy块的首页？）
		高 8 位是 enum pagetype
		可以用 PageBuddy 这种函数去判断类型。
		*/
		unsigned int page_type;
		/*  */
		atomic_t _mapcount;
	};

	atomic_t _refcount;
}
```

`mapping` 字段的低 2 位，即与 `PAGE_MAPPING_FLAGS` 相与，表示 4 种类型。分别是：

- 0 代表 `struct address_space`
- FOLIO_MAPPING_ANON `struct anon_vma`
- FOLIO_MAPPING_ANON_KSM 不存在这种情况？
- FOLIO_MAPPING_KSM `struct ksm_stable_node` folio_set_stable_node()

## struct ptdesc

- pmd_huge_pte 预先分配的一个 pte page table
- ptl 用于 PTE 页表锁

## struct slab

## struct folio

- mapping 字段
  - 如果是文件页。指向一个 `struct address_space`，表明所属的文件
  - 如果是匿名页。指向一个 `struct anon_vma`
- index 字段
  - 如果是文件页。这个就是文件内的偏移量，pgoff，单位为 4KB。
  - 如果是匿名共享页。这个就是相对于 vma->vm_start 的偏移量
  - 如果是匿名私有页。这个就是虚拟页面号

```cpp
folio_mapping
```

- `deferred_list` 被 thp 使用，

## pageflags

[pageflags](./pageflags.md)

## refcount 和 mapcount

- [page \_refcount 和\_mapcount 字段](https://blog.csdn.net/GetNextWindow/article/details/131905827)

## pagetype

```cpp
struct page {
	...
	union {
		/* 这两个占同一个位置
		如果高 8bit 在 0xf0-0xfe 范围内，就作为 pagetype 使用；
		否则+1作为 mapcount 使用，详见 folio_mapcount() */
		unsigned int page_type;
		atomic_t _mapcount;
		/* large folio 用 _large_mapcount 作为 mapcount */
	};
	...
};

enum pagetype {
	/* 0x00-0x7f are positive numbers, ie mapcount */
	/* Reserve 0x80-0xef for mapcount overflow. */
	PGTY_buddy		= 0xf0,
	PGTY_offline		= 0xf1,
	PGTY_table		= 0xf2,
	PGTY_guard		= 0xf3,
	PGTY_hugetlb		= 0xf4,
	PGTY_slab		= 0xf5,
	PGTY_zsmalloc		= 0xf6,
	PGTY_unaccepted		= 0xf7,
	PGTY_large_kmalloc	= 0xf8,

	PGTY_mapcount_underflow = 0xff
};

static inline bool page_type_has_type(int page_type)
{
	/* 注意！(PGTY_mapcount_underflow << 24) 实际上是一个负数。
	因此，如果 page_type 的高 8bit 在 0xf0-0xfe 范围内，则返回 true，
	如果在 0x00-0x7f 范围内，这返回 false，说明是正常的 mapcount，不是 pagetype */
	return page_type < (PGTY_mapcount_underflow << 24);
}
```

- PageBuddy()
- PageOffline()
- PageTable()
- PageGuard()
- PageHuge()
- PageSlab()
- PageZsmalloc()
- PageUnaccepted()

folio 版本为：

- folio_test_buddy()
- folio_test_offline()
- folio_test_table()
- folio_test_guard()
- folio_test_hugetlb()
- folio_test_slab()
- folio_test_zsmalloc()
- folio_test_unaccepted()
- folio_test_large_kmalloc()

一个规律，在 struct page 的变体里，比如 ptdesc，如果成员名 `__xxx`，大概意味着该成员未被该变体使用。

## 待重点分析的函数

- [ ] folio_referenced()
