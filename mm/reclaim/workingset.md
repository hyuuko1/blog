- 2014-02-04 [\[patch 00/10\] mm: thrash detection-based file cache sizing v9](https://lore.kernel.org/linux-mm/1391475222-1169-1-git-send-email-hannes@cmpxchg.org/)
  - 2012-05-02 [Better active/inactive list balancing \[LWN.net\]](https://lwn.net/Articles/495543/)
  - https://aistudio.google.com/prompts/1-YbmIW_NyHmLzDG_OqFLZl9VVOv72oxK
- 2019-11-07 [\[PATCH 0/3\] mm: fix page aging across multiple cgroups](https://lore.kernel.org/linux-mm/20191107205334.158354-1-hannes@cmpxchg.org/)
- 2020-05-20 [\[PATCH 00/14\] mm: balance LRU lists based on relative thrashing v2 - Johannes Weiner](https://lore.kernel.org/all/20200520232525.798933-1-hannes@cmpxchg.org/)
  - https://aistudio.google.com/app/prompts/1b663zgF2iTeI-yuVMM0zYnaikIwa4LW6
- 2020-07-23 [\[PATCH v7 0/6\] workingset protection/detection on the anonymous LRU list](https://lore.kernel.org/linux-mm/1595490560-15117-1-git-send-email-iamjoonsoo.kim@lge.com/)
  - 2020-03-10 [Working-set protection for anonymous pages \[LWN.net\]](https://lwn.net/Articles/815342/)

## 我最初的理解

一个容易理解的场景：假设有一个大文件，有一个进程反复从头到尾读这个文件，该文件的大小大于 inative list 的长度。这些 page cache 不会被放到 active，而是一直被回收，然后 refault 放到 inactive list。而 active 里的一些比这些 page cache 更 code 的页面并没有被回收（即使内核已经有机制会每次把 active list 里的一些放到 inactive，但效果不明显）。

对于从 folio 被回收到再次被访问的期间，定义这几个变量：

- `R`: 此期间，promotion 到 active list 头部的页面数量 + 回收的 evicted 页面数量。（不包含遍历 inactive list 时，放回到 inactive list 头部的数量）
- `E`: 此期间，通过 pagefault 等方式，新分配的用户页的数量，被放到 inactive list 头部。
- `refault_distance = R - E`：inactive list 的减少量（不包含从 active list 移动到 inactive list 的）
  - 或者可以理解为：在 inactive list 上扫描的页面数量（因为在此期间被放到 inactive list 头部的页面被认为是重复的已经扫描过的？例如，新分配然后放到 inactive list 的可以认为是先被 evicted 再分配的，因此也是被重复计算的，所以要减去？）
- `NR_inactive_file/anon`: page 第一次被访问，放到 inactive list 头部时，inactive list 的长度。
- `N = NR_inactive_file/anon + refault_distance`: page 第一 refault，到第二次 refault 期间，在 inactive list 上扫描的页面数量。
- `total = NR_inactive_file + NR_inactive_anon + NR_active_file + NR_active_anon`

在发生 refault 时，我们要考虑是放到 inactive list 的头部还是 active list 的头部，在 `workingset_refault()->workingset_test_recent()` 根据以上数值来做决定：

- 如果 `N > total`，说明，根据上一次的经验来看，即使我们这次放到 active list 头部，大概率也避免不了。因为 page 的两次 refault 期间，系统中所有的用户内存都被访问了，必定产生 refault，没法避免。
- 如果 `N < total`，说明，放到 active list 头部，也许可以避免 refault 的。

`lruvec->nonresident_age` 由 workingset_age_nonresident() 更新，并被以下几个函数调用。
每次完成 shrink_zones() 后，都 `snapshot_refaults()` 记录一个 `lruvec->nonresident_age` 的快照。
在发生 refault 时，将现在的 `lruvec->nonresident_age` 与之前记录的快照进行相减，得到前文提到的 `refault_distance` 值

- move_folios_to_lru() 统计的，在页面回收流程中扫描 lru list 时，被 promotion 到 active list 头部的页面数
- folio_mark_accessed() 统计的，被 promotion 到 active list 头部的页面数
- workingset_refault() 发生 refault 时（swap-in 或 pagefault 或 read 时找到了 shadow），如果 refault_distance <= workingset_size，则会被 promotion 到 active list 头部，要统计这个的数量。
- workingset_eviction() 在完成回收，释放页面之前，统计 evict 的页面数。

## 更精确的理解

最核心的是 `workingset_refault()`，

## 关键代码流程

页面即将回收完成并释放前，将此刻的 `lruvec->nonresident_age` 等信息保存到 swap file 的 struct address_space xarray 内，代码流程：

```cpp
/* anon/file folio 在回写完成后，在释放前，从 address_space 中移除（其实是替换为 shadow 值） */
shrink_folio_list()->__remove_mapping()
  /* 计算 shadow 值 */
  shadow = workingset_eviction(folio, target_memcg);
  /* 对于 anon folio */
  __delete_from_swap_cache()
    /* 原本的值是在 add_to_swap_cache() 里 xas_store(&xas, folio); 保存的 folio 指针
       现在修改为 void * shadow */
    xas_store(&xas, shadow);
  /* 对于 file folio */
  __filemap_remove_folio(folio, shadow)->page_cache_delete()
    /* 原本的值是在 __filemap_add_folio() 里 xas_store(&xas, folio); 保存的 folio 指针。
       现在修改为 void *shadow */
    xas_store(&xas, shadow);
```

页面发生 refault 时，决定放进 inactive list 还是 active list，代码流程：

```cpp
filemap_add_folio()/do_swap_page()/shmem_swap_alloc_folio()/__read_swap_cache_async()
  /* 把 folio 放进 swap cache，并且得到之前保存的 shadow 值 */
  add_to_swap_cache()
  workingset_refault(new_folio, shadow);
    /* 通过 shadow 值和 workingset 来计算，如果 refault_distance <= workingset_size 则继续往下走，进行 active */
    if (!workingset_test_recent())
      return;
    folio_set_active(folio);
```

## 平衡 file/anon 比例

也受 refault 影响。

shrink_node()->prepare_scan_control()

get_scan_count() 函数（被 shrink_node 调用）在决定扫描多少 file pages 和 anon pages 时，会考虑一个非常重要的反馈机制。它会比较 recent_scanned 和 recent_rotated 这两个 lruvec 级别的计数器。

- recent_scanned[file/anon]: 在 inactive list 上扫描了多少页面。
- recent_rotated[file/anon]: 有多少页面因为近期被访问过而从 active list 的尾部被移回头部（MGLRU 之前），或者是在 active list 内部轮转。

如果 recent_scanned 远大于 recent_rotated，说明 inactive list 上的页面大多是“冷的”，可以直接回收；反之，则说明 inactive list 上的页面经常被重新激活，可能意味着对这类页面的压力太大了。

workingset 机制通过 refault 影响这个平衡：

当一个 file page 发生 refault 并被提升到 active list 时，它增加了 file lru 的大小。当下一次内存压力来临时，为了平衡 file/anon 的比例，内核可能会增加对 file list 的扫描压力。

所以，refaults 并不直接调整扫描数量，而是通过改变 active/inactive list 的大小和构成，间接地影响了 get_scan_count() 的决策，形成了一个动态的负反馈循环，试图在 anon 和 file 内存之间找到一个最佳的平衡点。
