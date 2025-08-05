# GFP (Get Free Page)

- 🌟 [Linux GFP Types](https://zhuanlan.zhihu.com/p/1921413069709485955)

本篇文章讲解伙伴系统分配时的 flags 参数

```cpp
#define GFP_ATOMIC	(__GFP_HIGH|__GFP_KSWAPD_RECLAIM)
#define GFP_KERNEL	(__GFP_RECLAIM | __GFP_IO | __GFP_FS)
#define GFP_KERNEL_ACCOUNT (GFP_KERNEL | __GFP_ACCOUNT)
#define GFP_NOWAIT	(__GFP_KSWAPD_RECLAIM | __GFP_NOWARN)
#define GFP_NOIO	(__GFP_RECLAIM)
#define GFP_NOFS	(__GFP_RECLAIM | __GFP_IO)
#define GFP_USER	(__GFP_RECLAIM | __GFP_IO | __GFP_FS | __GFP_HARDWALL)
#define GFP_DMA		__GFP_DMA
#define GFP_DMA32	__GFP_DMA32
#define GFP_HIGHUSER	(GFP_USER | __GFP_HIGHMEM)
#define GFP_HIGHUSER_MOVABLE	(GFP_HIGHUSER | __GFP_MOVABLE | __GFP_SKIP_KASAN)
#define GFP_TRANSHUGE_LIGHT	((GFP_HIGHUSER_MOVABLE | __GFP_COMP | \
			 __GFP_NOMEMALLOC | __GFP_NOWARN) & ~__GFP_RECLAIM)
#define GFP_TRANSHUGE	(GFP_TRANSHUGE_LIGHT | __GFP_DIRECT_RECLAIM)
```

## `GFP_ZONE_TABLE`

## `GFP_ATOMIC`

分配内存时，不睡眠。

## `GFP_NOFS`

- [GFP masks used from FS/IO context — The Linux Kernel documentation](https://docs.kernel.org/core-api/gfp_mask-from-fs-io.html)

文件系统和 IO 栈中的代码路径在分配内存时必须小心，以防止递归死锁。
传统的方式是在分配内存时，传 `GFP_NOFS` 参数，与常用的 `GFP_KERNEL` 相比，它清除了 `__GFP_FS`。

`__GFP_FS` 表明允许调用文件系统的代码。例如，在 `super_cache_scan()` 里，如果检查到了没有 `__GFP_FS` flag，则会拒绝继续执行，防止发生死锁。

```cpp
static unsigned long super_cache_scan(struct shrinker *shrink,
                                      struct shrink_control *sc) {
  /*
   * Deadlock avoidance.  We may hold various FS locks, and we don't want
   * to recurse into the FS that called us in clear_inode() and friends..
   */
  if (!(sc->gfp_mask & __GFP_FS))
    return SHRINK_STOP;

  ... 后面可能会加锁
}
```

`GFP_NOFS` 和 `GFP_NOIO` 有滥用的情况，就引入了这几个 scope API 定义一个作用域，在该作用域内，内存分配操作不会递归回 FS/IO。

- `memalloc_nofs_save`
- `memalloc_nofs_restore`
- `memalloc_noio_save`
- `memalloc_noio_restore`

几个死锁的例子：

- [\[PATCH v11 15/25\] mm: Use memalloc_nofs_save in readahead path - Matthew Wilcox](https://lore.kernel.org/all/20200414150233.24495-16-willy@infradead.org/)
- [\[PATCH\] mm: use memalloc_nofs_save() in page_cache_ra_order() - Kefeng Wang](https://lore.kernel.org/all/20240426112938.124740-1-wangkefeng.wang@huawei.com/)
- [Removal of KM_NOFS - Matthew Wilcox](https://lore.kernel.org/linux-mm/ZRdNK39vc4TuR7g8@casper.infradead.org/)

从分配内存到 `super_cache_scan()` 的代码路径：

```cpp
/* 在 memalloc_nofs_save 的作用域分配内存时，调用到 super_cache_scan 时，
   是没有 __GFP_FS 的 */
__alloc_pages_noprof->__alloc_pages_slowpath->__alloc_pages_direct_reclaim->
  try_to_free_pages
    sc.gfp_mask = current_gfp_context(gfp_mask),
      unsigned int pflags = READ_ONCE(current->flags);
      if (pflags & PF_MEMALLOC_NOFS) /* memalloc_nofs_save 会设置此 flag */
        flags &= ~__GFP_FS; /* 移除 __GFP_FS */
    do_try_to_free_pages->shrink_zones->shrink_node->shrink_node_memcgs->shrink_slab
      do_shrink_slab->scan_objects:super_cache_scan()
```

## `GFP_NOIO`

与 `GFP_NOFS` 类似

## `__GFP_MOVABLE`

函数 `gfp_migratetype()` 用来把 gfp_flags 转换成迁移类型

- 使用标志 `__GFP_MOVABLE` 指定申请可移动页 `MIGRATE_MOVABLE`
- 使用标志 `__GFP_RECLAIMABLE` 指定申请可回收页 `MIGRATE_RECLAIMABLE`
- 如果没有指定这两个标志，表示申请不可移动页 `MIGRATE_UNMOVABLE`

`__GFP_MOVABLE` 有两个作用

1. 和 `__GFP_HIGHMEM` 组合表示从可移动区域分配物理页。
2. 在根据可移动性分组技术中表示申请迁移类型是可移动类型的物理页 `MIGRATE_MOVABLE`。

## `__GFP_RECLAIMABLE`

当使用 `__GFP_RECLAIMABLE` 标志进行内存分配时，表示：“我分配的页面是可回收的，如果系统内存紧张，可以将其回收。”

主要用于 slab 分配器中那些指定了 `SLAB_RECLAIM_ACCOUNT` 的内存分配（比如 sock_inode_cache），表明这些页面可以通过 shrinker 机制被释放。

```cpp
kvfree_rcu_init()
  kfree_rcu_shrinker = shrinker_alloc(0, "slab-kvfree-rcu");
  kfree_rcu_shrinker->count_objects = kfree_rcu_shrink_count;
  kfree_rcu_shrinker->scan_objects = kfree_rcu_shrink_scan;

do_shrink_slab()
  count_objects:kfree_rcu_shrink_count()
  scan_objects:kfree_rcu_shrink_scan()
```
