# TLB

`mm/mmu_gather.c`

## 使用案例

对于 kmalloc 区域的，直接 free_pages 即可，不需要修改页表。
对于 vmalloc 区域的，以及用户页面，典型的就是私有匿名映射页面，在释放前需要改页表的，就需要用到这些 API 了。

一般的用法流程是：

1. `tlb_gather_mmu()` 初始化 `struct mmu_gather`
2. `unmap_page_range()` 修改页表，此时还未 TLB flush
3. `tlb_finish_mmu()` 进行 TLB invalidate 并将页面释放回 SLUB

案例：

- [`__oom_reap_task_mm()`](./oom.md) 释放用户进程的私有匿名映射页面
- `exit_mmap()`

## 部分代码分析

```cpp
tlb_finish_mmu()
  tlb_flush_mmu()
    tlb_flush_mmu_tlbonly(tlb) /* TLB invalidate */
    tlb_flush_mmu_free()
      tlb_table_flush() /* TODO */
      tlb_batch_pages_flush() /* 释放和 swap cache */
        __tlb_batch_free_encoded_pages()->free_pages_and_swap_cache()
          free_swap_cache()
          folios_put_refs()->free_unref_folios()->free_one_page()
  /* 这里释放的是 struct mmu_gather_batch */
  tlb_batch_list_free()->free_pages()
```

## 文档

来自 `include/asm-generic/tlb.h` 的注释。

Generic MMU-gather implementation.

The `mmu_gather` data structure is used by the mm code to implement the
correct and efficient ordering of freeing pages and TLB invalidations.

This correct ordering is:

1. unhook page
2. TLB invalidate page
3. free page

That is, we must never free a page before we have ensured there are no live
translations left to it. Otherwise it might be possible to observe (or
worse, change) the page content after it has been reused.

The mmu_gather API consists of:

- `tlb_gather_mmu() / tlb_gather_mmu_fullmm() / tlb_finish_mmu()`

  start and finish a mmu_gather

  Finish in particular will issue a (final) TLB invalidate and free
  all (remaining) queued pages.

- `tlb_start_vma() / tlb_end_vma()`; marks the start / end of a VMA

  Defaults to flushing at `tlb_end_vma()` to reset the range; helps when
  there's large holes between the VMAs.

- `tlb_remove_table()`

  `tlb_remove_table()` is the basic primitive to free page-table directories
  (`__p*_free_tlb()`). In it's most primitive form it is an alias for
  `tlb_remove_page()` below, for when page directories are pages and have no
  additional constraints.

  See also `MMU_GATHER_TABLE_FREE` and `MMU_GATHER_RCU_TABLE_FREE`.

- `tlb_remove_page() / __tlb_remove_page()`
- `tlb_remove_page_size() / __tlb_remove_page_size()`
- `__tlb_remove_folio_pages()`

  `__tlb_remove_page_size()` is the basic primitive that queues a page for
  freeing. `__tlb_remove_page()` assumes PAGE_SIZE. Both will return a
  boolean indicating if the queue is (now) full and a call to
  `tlb_flush_mmu()` is required.

  `tlb_remove_page()` and `tlb_remove_page_size()` imply the call to
  `tlb_flush_mmu()` when required and has no return value.

  `__tlb_remove_folio_pages()` is similar to `__tlb_remove_page()`, however,
  instead of removing a single page, remove the given number of consecutive
  pages that are all part of the same (large) folio: just like calling
  `__tlb_remove_page()` on each page individually.

- `tlb_change_page_size()`

  call before `__tlb_remove_page*()` to set the current page-size; implies a
  possible `tlb_flush_mmu()` call.

- `tlb_flush_mmu() / tlb_flush_mmu_tlbonly()`

  `tlb_flush_mmu_tlbonly()` - does the TLB invalidate (and resets
  related state, like the range)

  `tlb_flush_mmu()` - in addition to the above TLB invalidate, also frees
  whatever pages are still batched.

- `mmu_gather::fullmm`

  A flag set by `tlb_gather_mmu_fullmm()` to indicate we're going to free
  the entire mm; this allows a number of optimizations.

  - We can ignore `tlb_{start,end}_vma()`; because we don't
    care about ranges. Everything will be shot down.

  - (RISC) architectures that use ASIDs can cycle to a new ASID
    and delay the invalidation until ASID space runs out.

- `mmu_gather::need_flush_all`

  A flag that can be set by the arch code if it wants to force
  flush the entire TLB irrespective of the range. For instance
  x86-PAE needs this when changing top-level entries.

And allows the architecture to provide and implement `tlb_flush()`:

`tlb_flush()` may, in addition to the above mentioned mmu_gather fields, make
use of:

- `mmu_gather::start / mmu_gather::end`

  which provides the range that needs to be flushed to cover the pages to
  be freed.

- `mmu_gather::freed_tables`

  set when we freed page table pages

- `tlb_get_unmap_shift() / tlb_get_unmap_size()`

  returns the smallest TLB entry size unmapped in this range.

If an architecture does not provide `tlb_flush()` a default implementation
based on `flush_tlb_range()` will be used, unless MMU_GATHER_NO_RANGE is
specified, in which case we'll default to `flush_tlb_mm()`.

Additionally there are a few opt-in features:

- `MMU_GATHER_PAGE_SIZE`

  This ensures we call `tlb_flush()` every time `tlb_change_page_size()` actually
  changes the size and provides mmu_gather::page_size to `tlb_flush()`.

  This might be useful if your architecture has size specific TLB
  invalidation instructions.

- `MMU_GATHER_TABLE_FREE`

  This provides tlb_remove_table(), to be used instead of `tlb_remove_page()`
  for page directores (`__p*_free_tlb()`).

  Useful if your architecture has non-page page directories.

  When used, an architecture is expected to provide `__tlb_remove_table()`
  which does the actual freeing of these pages.

- `MMU_GATHER_RCU_TABLE_FREE`

  Like `MMU_GATHER_TABLE_FREE`, and adds semi-RCU semantics to the free (see
  comment below).

  Useful if your architecture doesn't use IPIs for remote TLB invalidates
  and therefore doesn't naturally serialize with software page-table walkers.

- `MMU_GATHER_NO_FLUSH_CACHE`

  Indicates the architecture has `flush_cache_range()` but it needs _NOT_ be called
  before unmapping a VMA.

  NOTE: strictly speaking we shouldn't have this knob and instead rely on
  `flush_cache_range()` being a NOP, except Sparc64 seems to be
  different here.

- `MMU_GATHER_MERGE_VMAS`

  Indicates the architecture wants to merge ranges over VMAs; typical when
  multiple range invalidates are more expensive than a full invalidate.

- `MMU_GATHER_NO_RANGE`

  Use this if your architecture lacks an efficient flush_tlb_range(). This
  option implies `MMU_GATHER_MERGE_VMAS` above.

- `MMU_GATHER_NO_GATHER`

  If the option is set the mmu_gather will not track individual pages for
  delayed page free anymore. A platform that enables the option needs to
  provide its own implementation of the `__tlb_remove_page_size()` function to
  free pages.

  This is useful if your architecture already flushes TLB entries in the
  various `ptep_get_and_clear()` functions.
