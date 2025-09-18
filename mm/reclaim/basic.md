# 内存回收 - 基础

[内存回收旧版笔记](../reclaim.md)

按顺序来：

1. [物理内存分配](../page_alloc.md)，了解几种内存回收方式的触发条件和路径
2. 学习几种内存回收方式的区别，node_reclaim、direct_reclaim、kswapd reclaim
3. 学习内存回收机制，先看关键流程，再深入函数细节。
   1. scan_control
   2. [workingset](./workingset.md)
   3. active/inactive 之间的平衡、file/anon 之间的平衡
   4. shrink_lruvec()
      1. shrink_active_list
      2. shrink_inactive_list
   5. shrink_slab
   6. reclaim throttling
4. [MGLRU](./mglru.md)
5. 深入更底层
   1. writeback
   2. swap_cache, swap in/out
6. zswap
7. swap tableF

做一些总结：folio 在各个 active/inactive lru 链表之间的流转 [lru](./lru.md)，folio 的生命周期。

- 从 buddy 到 inactive
- 从 inactive promoted 到 active
- 从 active demoted 到 inactive
- 从 inactive evicted
- 从 inactive rotate 到 inactive head

挖掘演进历史
总结每个函数的作用。vmscan.c swap.c workingset.c

## 内存回收的触发条件、回收方式

- 内存回收的触发路径。
  - get_page_from_freelist() 时的 node_reclaim()，见 [page_alloc 快速路径](../page_alloc.md)。
  - kswapd 线程的间接回收。
  - 慢速路径的直接回收。

关注于 `struct scan_control`

## LRU 演进历程

- 2014-02-04 [\[patch 00/10\] mm: thrash detection-based file cache sizing v9](https://lore.kernel.org/linux-mm/1391475222-1169-1-git-send-email-hannes@cmpxchg.org/)
  - 2012-05-02 [Better active/inactive list balancing \[LWN.net\]](https://lwn.net/Articles/495543/)
  - https://aistudio.google.com/prompts/1-YbmIW_NyHmLzDG_OqFLZl9VVOv72oxK
- 2020-05-20 [\[PATCH 00/14\] mm: balance LRU lists based on relative thrashing v2 - Johannes Weiner](https://lore.kernel.org/linux-mm/20200520232525.798933-1-hannes@cmpxchg.org/)
  - https://aistudio.google.com/app/prompts/1b663zgF2iTeI-yuVMM0zYnaikIwa4LW6
- 2020-06-16 [\[PATCH for v5.8 0/3\] fix for “mm: balance LRU lists based on relative thrashing” patchset - js1304](https://lore.kernel.org/linux-mm/1592288204-27734-1-git-send-email-iamjoonsoo.kim@lge.com/)
- 2020-07-23 [\[PATCH v7 0/6\] workingset protection/detection on the anonymous LRU list - js1304](https://lore.kernel.org/linux-mm/1595490560-15117-1-git-send-email-iamjoonsoo.kim@lge.com/) 对匿名页的 workingset 保护
  - 2020-03-10 [Working-set protection for anonymous pages \[LWN.net\]](https://lwn.net/Articles/815342/)
  - 原先，匿名页在 refault 时，会无条件地进入 active list head，
- 2022-09-18 [\[PATCH mm-unstable v15 00/14\] Multi-Gen LRU Framework - Yu Zhao](https://lore.kernel.org/linux-mm/20220918080010.2920238-1-yuzhao@google.com/) 引入 MGLRU
  - 2021-04-02 [The multi-generational LRU \[LWN.net\]](https://lwn.net/Articles/851184/)
  - 2021-05-24 [Multi-generational LRU: the next generation \[LWN.net\]](https://lwn.net/Articles/856931/)
  - 2022-05-12 [Merging the multi-generational LRU \[LWN.net\]](https://lwn.net/Articles/894859/)
- 2023-05-18 [Page aging with hardware counters \[LWN.net\]](https://lwn.net/Articles/931812/)

其他比较小的改动

- 2009-06-08 [\[PATCH 0/3\] make mapped executable pages the first class citizen (with test cases) - Wu Fengguang](https://lore.kernel.org/linux-mm/20090608091044.880249722@intel.com/)
  - 2009-05-19 [Being nicer to executable pages \[LWN.net\]](https://lwn.net/Articles/333742/)
  - 可执行文件页更不容易 deactivate
- 2019-11-07 [\[PATCH 0/3\] mm: fix page aging across multiple cgroups](https://lore.kernel.org/linux-mm/20191107205334.158354-1-hannes@cmpxchg.org/)
- 2021-01-17 Linus Torvalds feb889fb40fa mm: don't put pinned pages into the swap cache
  - 不把 pinned pages 放进 swap cache
