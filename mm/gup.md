# GUP (Get User Page)

- [pin_user_pages() and related calls — The Linux Kernel documentation](https://docs.kernel.org/core-api/pin_user_pages.html)
- [宋宝华：论 Linux 的页迁移（Page Migration）完整版](https://cloud.tencent.com/developer/article/1681326)
  GUP 和页迁移有关，这里也提到了 GUP
- [get_user_pages(), pinned pages, and DAX \[LWN.net\]](https://lwn.net/Articles/787636/?utm_source=chatgpt.com)

## GUP 知识点一览

这里做一下简要记录，后面的段落再详细剖析

核心作用：通过增加页面的引用计数 `page->_refcount`，来阻止内核内存管理子系统回收或移动这个页面。也就是，pin 住 folio。

那么，为什么要阻止回收和移动呢？场景：

- 让用户空间内存安全地被设备 DMA。
  - 为什么内核自身分配的 buffer 等内存被设备 DMA 前，无需 pin 呢？因为这些内存本就不会被回收或移动。
  - 场景
    - MSG_ZEROCOPY `tcp_sendmsg_locked()->skb_zerocopy_iter_stream()->__zerocopy_sg_from_iter()->zerocopy_fill_skb_from_iter()->iov_iter_get_pages2()->__iov_iter_get_pages_alloc()->get_user_pages_fast()`
- 让内核能够安全、正确、高效地直接访问用户空间内存。函数调用后，用户内存对应的 struct page 指针记录在 pages 数组内，在 unpin 之前，内核都可以通过 struct page 得到对应的直接映射地址，安全高效地访问。

GUP 涉及到

- 增加额外的引用计数
- 缺页处理

还有一些杂项，有空写一下

- `xxx_fast()` 不需要加锁。
- 与 huge pages 和 DAX 相关的，暂不讨论

## 核心流程

最核心的流程在 `__get_user_pages_locked()->__get_user_pages()`，文字叙述下

1. locked 参数用于指示：进入此函数前，是否已经 mmap_read_lock(mm) 获取了 mm->mmap_lock 读信号量
   1. 如果为 0，表明 caller 要求此函数获取锁
   2. 否则，表明 caller 已经获取锁了。此处检查是否真的获取了，没获取就会 WARN
2. 如果 FOLL_PIN，会设置 mm->flags MMF_HAS_PINNED。作用：
   1. 在 folio_needs_cow_for_dma() 中快速判断
   2. [ ] pte_is_pinned()
3. 循环 `__get_user_pages()`

## 缺页异常处理

### 为什么会涉及到 `faultin_page()` 缺页处理

GUP 的核心目标是：获取并固定用户虚拟地址对应的物理页，供内核或设备长期访问。但用虚拟地址对应的物理页可能并不存在于内存中：

- 尚未分配
- 已 swap out
- 文件映射但未读入

因此，要主动模拟缺页异常，进行处理。

### 缺页处理时，遇到阻塞时的处理流程

缺页处理过程中可能会阻塞

TODO 后续把这个补充到 [pagefault](./pagefault.md)

- 如果设置了 `FOLL_UNLOCKABLE`，会影响 handle_mm_fault() 时的 fault_flags 参数：
  - 会带上 `FAULT_FLAG_ALLOW_RETRY`，允许返回 `VM_FAULT_RETRY`，
  - 会带上 `FAULT_FLAG_KILLABLE`，允许被 kill
- 如果设置了 `FOLL_NOWAIT`，会带上 `FAULT_FLAG_RETRY_NOWAIT` 使得遇到阻塞会直接失败

这里只举两个 fault 的例子，

1. filemap_fault()->lock_folio_maybe_drop_mmap()

```cpp
lock_folio_maybe_drop_mmap()
  /*  */
  if (folio_trylock(folio))
    /* 成功返回 */
    return 1;
  if (vmf->flags & FAULT_FLAG_RETRY_NOWAIT)
    return 0;
  /* 如果是第一次 retry，则 unlock mmap_lock 使得其他地方可以获取这锁，进行 io？ */
  *fpin = maybe_unlock_mmap_for_io();
  /*  */
  if (vmf->flags & FAULT_FLAG_KILLABLE) && (__folio_lock_killable(folio)) && (*fpin == NULL)
    release_fault_lock(vmf); /* 没懂这里 */
    return 0;
  /* 获取锁，阻塞睡眠 */
  __folio_lock(folio);
  /* 成功返回，但是已经释放了 mmap_lock 并且 fpin 指向了 pinned file，
     所以在 filemap_fault() 里是会 folio_unlock() goto out_retry 返回 VM_FAULT_RETRY 的 */
  return 1;
```

2. do_swap_page()->folio_lock_or_retry() 也差不多

如果阻塞了，会释放 mmap_lock，然后等到 folio unlock 的情况下返回 VM_FAULT_RETRY。

## 如何防止被回收的？

在内存回收时，在完成 `shrink_folio_list()->try_to_unmap()` 移除所有进程页表映射，减少这些带来的 refcount 后，

- 对于匿名页，`shrink_folio_list()->folio_ref_freeze()` 会返回 false
- 对于文件页，`shrink_folio_list()->__remove_mapping()->folio_ref_freeze()` 会返回 false

## 如何 pin 住内存不被移动的？

`get/pin_user_pages()` 函数，当 pages 参数不为 NULL 时，都会 pin 内存。
如果 pages 参数是 NULL，则只保证触发缺页处理，不会去 pin 内存。

如何做到 pin 内存的？
try_grab_folio() 的 FOLL_GET/FOLL_PIN 都会增加额外的引用计数。

以内存规整流程时的页面迁移为例，检测到存在 unexpected references，就会 return -EAGAIN 不进行页面迁移。

```cpp
compact_zone()
  migrate_pages()->migrate_pages_batch()->migrate_folios_move()->migrate_folio_move()
    move_to_new_folio()->migrate_folio()->__migrate_folio()
      /* detect unexpected references (e.g., GUP or other temporary references) */
      expected_count = folio_expected_ref_count(src) + 1;
      if (folio_ref_count(src) != expected_count)
        return -EAGAIN;
      folio_mc_copy(dst, src);
      __folio_migrate_mapping()
```

## FOLL_GET/FOLL_PIN 有何区别

FOLL_PIN 和 FOLL_GET 是互斥的，不能同时使用。

会影响 folio_maybe_dma_pinned() 的结果。

- 对于 FOLL_PIN，一定返回 true；
- 对于 FOLL_GET，则是**大概率**返回 false，虽然小概率返回 true，但可以容忍这种小错误。

---

`__get_user_pages()` 的注释，

返回成功 pin 的 page 数量，或者错误。
调用时必须持有 mmap_lock。
如果有 FOLL_UNLOCKABLE 但是没有 FOLL_NOWAIT，那么 mmap_lock 也许会被释放，此时 locked 会被置 0

遍历进程的页表，并为每个用户地址此时对应的 page 增加引用计数。
注意，该函数不能避免这种情况：
在此函数返回时，可能用户的其他线程就 unmap 了，导致用户没有映射该 page。

```cpp
__get_user_pages_locked()

__get_user_pages()
  page = follow_page_mask()->...
    follow_page_pte()
      page = vm_normal_page(vma, address, pte);
      folio = page_folio(page);
      try_grab_folio(folio, 1, flags);
  /* 如果返回的 page 是 NULL，就需要 faultin_page()，
     如果成功 faultin_page() 了，就 retry 重新 follow_xxx 得到 page */
  faultin_page()
```

## FOLL_LONGTERM

FOLL_LONGTERM，其核心作用是为了防止长期 pin 时，一直不能移动，可能造成碎片化。

只有在用了 FOLL_PIN 时，才允许使用 FOLL_LONGTERM

根据我看的代码，传入 FOLL_LONGTERM 并没有增加页的固定计数，而是进行了 memalloc_pin_save() 和 check_and_migrate_movable_pages()，确保被 pin 的页面的 migratetype 都是 MIGRATE_UNMOVABLE 的，并且不在 ZONE_MOVABLE 内。
相关的函数有：

1. collect_longterm_unpinnable_folios() 收集不可长期 pin 的 folios
2. folio_is_longterm_pinnable() 判断该 folio 是否是可以长期 pin 的
3. migrate_longterm_unpinnable_folios() 将不可长期 pin 的 folios，先进行 unpin，然后再 migrate_pages()将 folio 迁移，迁移的 target 由 alloc_migration_target()分配

所以，何时应使用 FOLL_LONGTERM ?
我认为是当用户认为 pages 会被长期固定住时，需要使用 FOLL_LONGTERM 作为一个提示，让内核保证页面的 migratetype 都是 MIGRATE_UNMOVABLE 的，并且不在 ZONE_MOVABLE 内。
我的理由：这是为了防止长期的页面固定导致长期的内存碎片化。

vfio 和 vhost-vdpa 调用 pin_user_pages 时，都用了这个 flag，
因为是虚拟机的内存，肯定是会 pin 很久的。

## FOLL_UNLOCKABLE

关于 FOLL_UNLOCKABLE，允许 gup 的过程中在 faultin_page() 里因一些原因释放 mmap_lock。

1. 何时设置的？当用户调用的是 `pin_user_pages_unlocked()` 时
2. 如何影响 handle_mm_fault() 的？根据 faultin_page() 的注释，如果有 FOLL_UNLOCKABLE 但是没有 FOLL_NOWAIT。就会使得 faultin_page() 里当 folio_trylock() 失败时（何种情况下会 folio 被 lock 了呢？文件页写回？），释放 mmap_lock 减少争用，并返回 VM_FAULT_RETRY 或 VM_FAULT_COMPLETED。如果真释放了，把 locked 改为 0。
   具体释放的代码位置：`__folio_lock_or_retry()/maybe_unlock_mmap_for_io()/__folio_lock_or_retry()/lock_folio_maybe_drop_mmap()`。

## PG_anon_exclusive

1. PG_anon_exclusive 没搞懂。do_wp_page()->wp_can_reuse_anon_folio() 里，如果 folio_ref_count(folio) 不是 1，那就 return false？
   为什么这样判断？如果 gup 了，就不能 reuse 吗。
   难道不应该是判断 mapcount，当确认只有一个 mapcount 时，就 reuse 吗？

`__folio_try_share_anon_rmap()` 里 PageAnonExclusive 和 GUP 有何关系？

## mlock()

1. mlock 的作用：防止内存被交换出去
2. mlock() 的代码流程：
   1. 会对指定的地址区间的 vma 进行 split，然后对这个 vma 设置 VM_LOCKED flag，
   2. 调用 gup API，
      1. 但是 pages 参数是 NULL，因此不会额外增加引用计数，也就是说，不会 pin 内存。
      2. 在 gup 的 faultin_page() 流程中，会在 folio_add_lru_vma() 时 folio_set_mlocked() 设置 PG_mlocked 并放进 mlock_fbatch
   3. 后续某一时刻在 lru_add() 时会 folio_evictable() 判断 PG_mlocked 得知是不可交换的，所以会 folio_set_unevictable(folio);
      疑问：PG_mlocked 和 PG_unevictable 有何区别？我的理解是：PG_mlocked 一定是 PG_unevictable 的，但反之则不对。
      因为对于所在 struct address_space 有 AS_UNEVICTABLE flag 的 folio 而言，该 folio 是 PG_unevictable 的。

注意，`populate_vma_page_range()` 并未传入 FOLL_GET 或 FOLL_PIN 参数。
