# mmap

## 私有匿名页

```cpp
do_anonymous_page
  alloc_anon_folio->folio_prealloc->vma_alloc_folio->vma_alloc_folio_noprof()
    folio_alloc_mpol_noprof()->alloc_pages_mpol_noprof()->__alloc_pages_noprof()
      get_page_from_freelist()

exit_mmap
  arch_exit_mmap->ldt_arch_exit_mmap->free_ldt_pgtables->free_pgd_range()->...
  unmap_vmas->unmap_single_vma->unmap_page_range() /* 这里和 __oom_reap_task_mm 那里是一样的 */
```
