# 内存反碎片技术

## 参考

- [Linux 内核 VS 内存碎片 （上） | PingCAP 平凯星辰](https://cn.pingcap.com/blog/linux-kernel-vs-memory-fragmentation-1/)
  列出了一些 LWN 文章。
- [Linux 内核 VS 内存碎片 （下） | PingCAP 平凯星辰](https://cn.pingcap.com/blog/linux-kernel-vs-memory-fragmentation-2/)
- [Linux 中的 Memory Compaction \[一\] - 知乎](https://zhuanlan.zhihu.com/p/81983973)
- [Linux 中的 Memory Compaction \[二\] - CMA - 知乎](https://zhuanlan.zhihu.com/p/105745299)
- [Linux 中的 Memory Compaction \[三\] - THP - 知乎](https://zhuanlan.zhihu.com/p/117239320)
- [由 Linux 的内存碎片问题说开来 - 知乎](https://zhuanlan.zhihu.com/p/351780620)
- [超详细！Linux 内核内存规整详解-CSDN 博客](https://blog.csdn.net/feelabclihu/article/details/134343592)
- [LWN: 让 ZONE_MOVABLE 更加名副其实！-CSDN 博客](https://blog.csdn.net/Linux_Everything/article/details/113667395)
- [对于 ZONE_MOVABLE 的理解\_zone movable-CSDN 博客](https://blog.csdn.net/rikeyone/article/details/86498298)
- [对于 MIGRATE_MOVABLE 的理解\_movable migrate type-CSDN 博客](https://blog.csdn.net/rikeyone/article/details/105863277)
- [内存管理中关于 Movable 的理解 - aspirs - 博客园](https://www.cnblogs.com/aspirs/p/12781693.html)
- [linux kernel 内存碎片防治技术](https://www.wowotech.net/memory_management/memory-fragment.html)

## 相关

- [CMA (Contiguous Memory Allocator) 连续内存分配器](./cma.md)
- [THP (Transparent Huge Page) 透明大页](./thp.md)

## 外部碎片

为了解决外部碎片问题，内核引入了以下反碎片技术。

1. 2.6.23 版本引入了虚拟可移动区域。
2. 2.6.23 版本引入了成块回收（lumpy reclaim，有的书中翻译为集中回收）， 3.5 版本废除，被内存碎片整理技术取代。
   成块回收不是一个完整的解决方案，它只是缓解了碎片问题。成块回收，就是尝试成块回收目标页相邻的页面，以形成一块满足需求的高阶连续页块。这种方法有其局限性，就是成块回收时没有考虑被连带回收的页面可能是“热页”，即被高强度使用的页，这对系统性能是损伤。
3. 2.6.24 版本引入了根据可移动性分组的技术，把物理页分为不可移动页、可移动页和可回收页 3 种类型。
4. 2.6.35 版本引入了内存碎片整理技术。

虚拟可移动区域和根据可移动性分组是预防外部碎片的技术，
成块回收和内存碎片整理是在出现外部碎片以后消除外部碎片的技术。

## 虚拟可移动区域 ZONE_MOVABLE

从平台最高内存（在 32bit 系统中是 ZONE_HIGHMEM，在 64bit 系统中是 ZONE_NORMAL）中划分出了一部分内存，作为 ZONE_MOVABLE。

基本思想很简单：在可移动区域内，只允许分配可移动的页面。

内核启动参数

```bash

```

分配给内核使用的内存，都是不可移动的（因为存在线性映射，这个映射不能修改），所以不能从 ZONE_MOVABLE 分配。
XXX vmalloc 分配的内存，不是线性映射的，应该可以移动？

给用户分配的匿名页，使用的是 `GFP_HIGHUSER_MOVABLE` 包含了 `__GFP_HIGHMEM | __GFP_MOVABLE`，意味着可以从 ZONE_MOVABLE 分配。

## 根据迁移类型进行分组

## 内存碎片整理

详见 [memory compaction](./compaction.md)
