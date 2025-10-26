# 页面分配

## 关键知识点一览

- watermark
- 有 `__GFP_WRITE` 时，ac->spread_dirty_pages 为 true
- cpuset 影响 `__GFP_HARDWALL` 和 ac->nodemask，
  会限制当前 cpu 可以在哪些 node 分配内存
- ALLOC_NOFRAGMENT 会使得从其他 migratetype 的 pageblock steal page 时，让 order 至少为 pageblock order，也就是说至少 steal 整个 pageblock，修改 pageblock 的 migratetype，而不会使得 pageblock 内同时有多种 migratetype 的 page，造成碎片化。
- ac->highest_zoneidx 就是 gfp_zone(gfp_mask)，也就是可以最高可以从哪个 zonetype 的 zone 里分配，比如 GFP_NORMAL
- [vm.zone_reclaim_mode](sysctl/vm.zone_reclaim_mode.md)

```cpp
__alloc_frozen_pages_noprof()
  unsigned int alloc_flags = ALLOC_WMARK_LOW;
  /* low mark */
  get_page_from_freelist()
  __alloc_pages_slowpath()
```

## get_page_from_freelist()

1. for_next_zone_zonelist_nodemask(zone, z, ac->highest_zoneidx, ac->nodemask)
   1. 如果分配后不满足 high 水线，则记录 set_bit(ZONE_BELOW_HIGH, &zone->flags);
   2. 如果分配后不满足当前要求的水线，则由 vm.zone_reclaim_mode 控制是否 node_reclaim() 只在当前 node 上回收内存，以及如何回收。详见 [vm.zone_reclaim_mode](sysctl/vm.zone_reclaim_mode.md)
   3. 如果满足水线，则 rmqueue() 从 buddy system 中分配
      1. 如果 pcp_allowed_order() order 为 0-3 或 THP 的 order，则 rmqueue_pcplist() 从 percpu 链表中直接拿，用 percpu 的粒度小的锁。
      2. 否则，rmqueue_buddy() 从 zone 里的链表里拿，用 zone 粒度的锁。会以不同的参数调用 `__rmqueue_smallest()`：
         1. 如果是 ALLOC_HIGHATOMIC high-order atomic 分配，则优先用 migratetype `MIGRATE_HIGHATOMIC`
         2. 否则就 `__rmqueue()`
            1. 先用 ac->migratetype
            2. 如果失败，且如果允许 ALLOC_CMA，则用 `MIGRATE_CMA`
            3. 还不行就 `__rmqueue_claim()`
               1. 如果 order>= pageblock_order，就改变整个 pageblock 的 migratetype（不会造成碎片化），否则不改变
               2. try_to_claim_block() 的作用详见 https://g.co/gemini/share/247c3aa86588
            4. 如果实在不行，而且没有 ALLOC_NOFRAGMENT，允许碎片化，就 `__rmqueue_steal()`，fallback 到其他 migratetype 进行窃取，不会改变 pageblock 的 migratetype，但这样使得该 pageblock 内的页面。在 `__del_page_from_free_list()` 里会打印 WARN。
               1. 如果我们要分配 Unmovable 的，但是从 movable pageblock 里分配了，那么要是将来内存规整时把这页面移动了咋办？详见 https://g.co/gemini/share/247c3aa86588
                  1. 其实，如果我们不传入 `__GFP_MOVABLE` 标志，page alloc 时是不会给该 page 加上啥东西来防止页面将来被迁移的，如果我们要防止页面被迁移，那需要自己另作操作，比如 GUP。所以，页面能否迁移，和 pageblock 的 MIGRATE_MOVABLE 没任何关系。
                  2. 那么，pageblock 的 MIGRATE_MOVABLE 的作用是什么呢？答：是为了让同一个 pageblock 内的页面的可移动性“尽可能地”相同，也就是**在同一个 pageblock 内尽可能地申请具有相同可移动性的页面**，也就是“根据可移动性分组”（这个“可移动性”取决于用户是否 gup，并不取决于 pageblock 的 migratetype），这样可以让内存规整时更为顺利。因此，可以说，`__rmqueue_steal()` 会污染 pageblock，可能会使得内存规整遍历到这个 MIGRATE_MOVABLE 的 pageblock 时遇到无法迁移的页面（如果被用户 gup 了），可能造成碎片化。
         3. 如果分配失败，但是 ALLOC_OOM ALLOC_NON_BLOCK，那么就偷用 `MIGRATE_HIGHATOMIC` 来分配，因为相比于将来 high-order atomic 失败，此时在这里分配失败要更糟糕。

---

最后都会 `__rmqueue_smallest()`

1. for (current_order = order; current_order < NR_PAGE_ORDERS; ++current_order)
   1. 得到链表头的 page = get_page_from_free_area(&(zone->free_area[current_order]), migratetype);
   2. page_del_and_expand()
      1. 将该 page 从链表取下
      2. expand() 如果该 page 的 order 比我们要的大，就分解出不需要的，放回 freelist
