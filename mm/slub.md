# SLUB 内存分配器

- SLUB 适用于 NUMA
- SLAB (已废弃) 适用于 UMA
- SLOB (已废弃) 适用于小内存场景

## 参考

- [细节拉满，80 张图带你一步一步推演 slab 内存池的设计与实现 - 知乎](https://zhuanlan.zhihu.com/p/619560125)
- [从内核源码看 slab 内存池的创建初始化流程 - 知乎](https://zhuanlan.zhihu.com/p/621239181)
- [深入理解 slab cache 内存分配全链路实现 - 知乎](https://zhuanlan.zhihu.com/p/626883293)
- [深度解析 slab 内存池回收内存以及销毁全流程 - 知乎](https://zhuanlan.zhihu.com/p/632323986)

##

- 外碎片：还没有被分配出去的空闲页面，可以满足当前申请的长度要求，但是由于它们的地址不连续或其他原因，使得系统无法满足当前申请
  - 伙伴系统，主要为了解决外碎片的问题。为了满足对连续大的页框的需求。
- 内碎片：已经被操作系统分配给进程的内存区域，但是占有该区域的进程无法使用该区域里的部分内存。例子：申请的内存不是对齐的，产生的多余空间就是内部碎片。
  - slab 算法

## 初始化

初始化的过程，就是把 memblock 内存释放到 buddy system

```cpp
mm_core_init
  mem_init()
    memblock_free_all();
      /* MEMBLOCK_NONE */
      free_low_memory_core_early();
        __free_memory_core()->__free_pages_memory()
          memblock_free_pages()->__free_pages_core()->__free_pages_ok()
            free_pages_prepare()
            free_one_page() /*  */
    preallocate_vmalloc_pages();v
  kmem_cache_init();
  vmalloc_init();


free_one_page()->split_large_buddy()
  /* 每次最多释放 2^9 */
  if (order > pageblock_order)
    order = pageblock_order;
  __free_one_page()
    struct page *buddy =find_buddy_page_pfn()
    __del_page_from_free_list()
    /* page->buddy_list 放入 zone->free_area[order].free_list[migratetype] 链表  */
    __add_to_free_list()

```

## 页面分配

核心函数 `__alloc_pages_noprof()`

来看看该函数的调用方，逆向的

```bash
sudo bpftrace -e 'kfunc:vmlinux:__alloc_pages_noprof  { @[kstack] = count(); }'
sudo bpftrace -e 'kfunc:vmlinux:alloc_pages_bulk_noprof  { @[kstack] = count(); }'
```

- `alloc_pages_bulk_noprof()` 分配 0 阶的 nr_pages 个页面，不连续
- `alloc_pages_mpol_noprof()` 分配 order 阶的页面，连续
