# struct page

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

## 后续

[folio](./folio.md)
