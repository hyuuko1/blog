# memory management

这个系列主要记录：

1. 参考资料
2. 内存管理主要特性

内存管理系列笔记，会记录：

1. 内存相关的系统调用、/proc、/sys

## TODO 服务器体系(SMP，NUMA，MPP)与共享存储器架构(UMA 和 NUMA)

## Linux 内存管理概述

Linux 把物理内存划分为三个层次来管理

1. 存储节点(Node)

   CPU 被划分为多个节点(node)，内存则被分簇，每个 CPU 对应一个本地物理内存，即一个 CPU-node 对应一个内存簇 bank，即每个内存簇被认为是一个节点

2. 管理区(Zone)

   每个物理内存节点 node 被划分为多个内存管理区域，用于表示不同范围的内存，内核可以使用不同的映射方式映射物理内存

3. 页面(Page)

   内存被细分为多个页面帧，页面是最基本的页面分配的单位

## 内存管理子系统发展脉络

- [现在的 Linux 内核和 Linux 2.6 的内核有多大区别？ - larmbr 宇的回答 - 知乎](https://www.zhihu.com/question/35484429/answer/62964898)
- [KernelNewbies: LinuxVersions](https://kernelnewbies.org/LinuxVersions)

1. 内存分配
   1. 页分配器: 伙伴分配器 https://www.kernel.org/doc/gorman/html/understand/understand009.html
   2. 对象分配器: 内核级别的 malloc 分配器
      1. SLAB，2.0 版本时代(1996 年引入) 对象缓存、硬件缓存对齐和着色
      2. SLUB，2.6.22(2007 年 7 月发布) 为 NUMA 提供更好的支持
      3. SLOB，2.6.16(2006 年 3 月发布) 适用于嵌入式
   3. 连续内存分配器(CMA)，3.5(2012 年 7 月发布)
2. 内存去碎片化
   1. 成块回收(Lumpy Reclaim) 2.6.23 引入(2007 年 7 月)，3.5 移除(2012 年 7 月)
   2. 基于页面可移动性的页面聚类(Page Clustering by Page Mobility) 2.6.23(2007 年 7 月发布)
   3. 内存紧致化(Memory Compaction) 2.6.35(2010 年 8 月发布)
3. 页表管理
   1. 四级页表 2.6.11(2005 年 3 月发布)
   2. 延迟页表缓存冲刷 (Lazy-TLB flushing)，极早引入，时间难考
4. 页面回收
   1. 增强的 LRU 算法 (2.6 前引入，具体时间难考)
   2. active 与 inactive 链表拆分，2.6.28(2008 年 12 月)
   3. 再拆分出被锁页的链表，2.6.28(2008 年 12 月)
   4. 让代码文件缓存页多待一会，2.6.31(2009 年 9 月发布)
   5. 工作集大小的探测，3.15(2014 年 6 月发布)
5. 页面写回
   1. 由全局的脏页门槛到每设备脏页门槛 2.6.24(2008 年 1 月发布)
   2. 引入更具体扩展性的回写线程 2.6.32(2009 年 12 月发布)
   3. 动态的脏页生成扼制和写回扼制算法 3.1(2011 年 11 月发布)，3.2(2012 年 1 月发布)
6. 页面预读
   1. 原始的预读方案 (时间很早，未可考)
   2. 按需预读(On-demand Readahead) 2.6.23(2007 年 10 月发布)
7. 大内存页支持
   1. HUGETLB 支持 (2.6 前引入)
   2. 透明大页的支持 2.6.38(2011 年 3 月发布)
   3. 内存控制组(Memory Cgroup)支持 2.6.25(2008 年 4 月发布)
8. 内存控制组(Memory Cgroup)支持 2.6.25(2008 年 4 月发布)
9. 内存热插拔支持
   1. 内存热插入支持 2.6.15(2006 年 1 月发布)
   2. 初步的内存逻辑热拔除支持 2.6.24(2008 年 1 月发布)
   3. 完善的内存逻辑热拔除支持 3.8(2013 年 2 月发布)
   4. 物理热拔除的支持 3.9(2013 年 4 月支持)
10. 超然内存(Transcendent Memory)支持
    1. 前端接口之 CLEANCACHE 3.0(2011 年 7 月发布)
    2. 前端接口之 FRONTSWAP 3.5(2012 年 7 月发布)
    3. 后端之 ZCACHE (没能进入内核主线)
    4. 后端之 ZRAM 3.14(2014 年 3 月发布)
    5. 后端之 ZSWAP 3.11(2013 年 9 月发布)
11. 非易失性内存 (NVDIMM，Non-Volatile DIMM) 支持
    1. NVDIMM 支持框架: libnvdimm 4.2(2015 年 8 月 30 日发布)
    2. DAX 4.0(2015 年 4 月发布)
12. 内存管理调试支持
    1. 页分配的调试支持 2.5(2003 年 7 月之后发布)
    2. SLAB 子系统的调试支持
    3. 错误注入机制 2.6.20(2007 年 2 月发布)
    4. KMEMCHECK - 内存非法访问检测工具 2.6.31(2009 年 9 月发布)
    5. KMEMLEAK - 内存泄漏检测工具 2.6.31(2009 年 9 月发布)
    6. KASan - 内核地址净化器 4.0(2015 年 4 月发布)
13. 杂项
    1. KSM - 内存去重 2.6.32(2009 年 12 月发布)
    2. HWPoison - 内存页错误的处理 2.6.32(2009 年 12 月发布)
    3. Cross Memory Attach - 进程间快速消息传递 3.2(2012 年 1 月发布)

## 这个系列讲什么？

1. 物理内存管理
   内存模块具有一定层次结构的，从物理内存到软件控制的内存经过了几个层次的隔离。
   大致我们能看到这么四个层次的内存管理结构。前两者基本在内核启动时使用，而平时大多使用的是后两者。
   1. [](./e820.md) e820 从硬件获取内存分布
   2. [](./memblock.md) 原始内存分配器--memblock
   3. 页分配器
   4. Slub 分配器
2. 虚拟内存管理
3. 高级特性
   1. 页面回收
   2. 大页

## 参考资料

- 《奔跑吧 Linux 内核 第二版卷一》由浅入深，适合入门，涉及的内容也很多
- [内存管理 - 标签 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/tag/%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86/) 有许多配图，非常棒！
- [兰新宇 - 知乎](https://zhuanlan.zhihu.com/p/93289632) 非常推荐，会介绍演进/优化历史，不侧重代码
- [五花肉 - 知乎](https://zhuanlan.zhihu.com/p/610256038) 有很多高级特性的分析
- [内存管理 - 蜗窝科技](http://www.wowotech.net/sort/memory_management)
- [内存管理\_HZero-CSDN 博客](https://blog.csdn.net/jasonactions/category_10652690.html?spm=1001.2014.3001.5482) 有许多配图，非常棒！
- [内存管理\_bin_linux96 的专栏-CSDN 博客](https://blog.csdn.net/bin_linux96/category_7457811.html)
- [linux 内存\_菁的博客-CSDN 博客](https://blog.csdn.net/u010923083/category_10971696.html)
- 🌟 [内存管理 | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/nei-cun-guan-li)
- 🌟 bin 的技术小屋 https://www.zhihu.com/column/c_1550511492654600192
- 🌟 https://github.com/gatieme/LDD-LinuxDeviceDrivers/tree/master/study/kernel/02-memory
  **建议看这个！！**
- http://www.biscuitos.cn/blog/BiscuitOS_Catalogue/

## 其他

- 外碎片：还没有被分配出去的空闲页面，可以满足当前申请的长度要求，但是由于它们的地址不连续或其他原因，使得系统无法满足当前申请
  - 伙伴系统，主要为了解决外碎片的问题。为了满足对连续大的页框的需求。
- 内碎片：已经被操作系统分配给进程的内存区域，但是占有该区域的进程无法使用该区域里的部分内存。例子：申请的内存不是对齐的，产生的多余空间就是内部碎片。
  - slab 算法

## TODO

- memremap
