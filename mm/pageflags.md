# pageflags 页标志

- [内存管理-38-页标志-1-pageflags - Hello-World3 - 博客园](https://www.cnblogs.com/hellokitty2/p/18528107)
- [Linux page flags - 知乎](https://zhuanlan.zhihu.com/p/713935921)
- [Linux - 物理内存 - 知乎](https://zhuanlan.zhihu.com/p/664104444)
- [Memory Management | What is the Utopian World!](https://utopianfuture.github.io/kernel/Memory-Management.html)
- _The Linux Memory Manager_ 2.1.3 Page flags

```cpp
Pagexxx()
SetPagexxx()
__SetPagexxx() 不保证原子性
TestSetPagexxx()
ClearPagexxx()
__ClearPagexxx()
TestClearPagexxx()

folio_test_xxx()
folio_set_xxx()
__folio_set_xxx()
folio_test_set_xxx()
folio_clear_xxx()
__folio_clear_xxx()
folio_test_clear_xxx()

/* 这两函数一样，判断 page/folio 是否是 hugetlb，
   判断依据：folio->page.page_type 的高 8 位来是否有 PGTY_hugetlb */
folio_test_hugetlb()
PageHuge()
/* 是否是复合页，即分配时带有 __GFP_COMP flag 的页面，比如：hugetlb 或 thp 等等。
   判断依据是：PG_head 或者 page->compound_head 是否最低位是否为 1（即：是否是 subpage） */
PageCompound()
PageTransCompound()
```

- 目前 page_type 好像和 TLMM 讲的还不太一样

##

- PG_writeback 正在回写
