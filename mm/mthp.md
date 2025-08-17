# multi-size THP

先看：[folio](./folio.md)

再看：

- 🌟 [Linux mTHP 动态大页 - 知乎](https://zhuanlan.zhihu.com/p/1935858158611457363)
- 🌟 [内存管理特性分析（十二）:大页(huge pages)技术分析 - 知乎](https://zhuanlan.zhihu.com/p/609457879)
- 🌟 [内存管理特性分析（二十）：Linux Large Folios 大页技术分析](https://zhuanlan.zhihu.com/p/698537078)
- 🌟 [Linux Large Folios 大页在社区和产品的现状和未来 - OPPO 内核工匠](https://blog.csdn.net/feelabclihu/article/details/137983188)
- [Transparent Hugepage Support — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/mm/transhuge.html)
- [多尺寸 THP 创建，两种不同的方式 - 知乎](https://zhuanlan.zhihu.com/p/23703525187)
- [多尺寸透明巨型页面性能两讲 - 知乎](https://zhuanlan.zhihu.com/p/700154853)

## patch 分析

- mTHP sysfs Support
- Multi-size THP for anonymous memory
- Transparent Contiguous PTEs for User Mappings
- Swap-out mTHP without splitting
- mm: support large folios swap-in
  未合入
