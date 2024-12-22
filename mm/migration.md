# 页面迁移

页面迁移的粒度好像是 pageblock ？

```cpp
/* 9 */
#define pageblock_order		MIN_T(unsigned int, HUGETLB_PAGE_ORDER, MAX_PAGE_ORDER)
/* 512 */
#define pageblock_nr_pages	(1UL << pageblock_order)
```
