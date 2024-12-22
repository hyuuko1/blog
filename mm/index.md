# 内存管理专题

更新计划

1. 内存分配
   - [x] vmalloc, vmap
   - [x] percpu 分配器
   - [x] buddy system 物理页面分配器
   - [ ] kmalloc：SLUB
     - 还未 review kfree 的 code
   - [x] CMA
     - [ ] dma-mapping
     - [ ] dma pool
2. [ ] 内存布局
3. 进程地址空间
   1. [ ] VMA
   2. [ ] mmap
   3. [ ] cow
4. 与文件系统相关的 page cache
   1. [ ] readahead
   2. [ ] writeback
5. 大页提升性能
   1. [ ] hugetlb
   2. [ ] THP
6. 内存不足时用的
   1. [x] OOM
   2. [x] rmap
   3. [ ] 内存回收 reclaim
   4. [ ] 内存规整 compaction
   5. [ ] 内存迁移 migrate
   6. [ ] KSM
   7. [ ] swap
   8. [ ] zram
   9. [ ] zswap
7. [ ] 内存热插拔
8. [ ] mm cgroup
9. 暂时不考虑
   1. highmem，在 x86_64 里没有
   2. 非易失性内存

## 学习方法

- [如何展开 Linux Memory Management 学习？ - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/7977847.html)

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

## 参考资料

- 🌟《奔跑吧 Linux 内核 第二版卷一》由浅入深，适合入门，涉及的内容也很多
- 🌟[内存管理 - 标签 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/tag/%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86/) 有许多配图，非常棒！
- 🌟[兰新宇 - 知乎](https://zhuanlan.zhihu.com/p/93289632) 非常推荐，会介绍演进/优化历史，不侧重代码
- [五花肉 - 知乎](https://zhuanlan.zhihu.com/p/610256038) 有很多高级特性的分析
- [内存管理 - 蜗窝科技](http://www.wowotech.net/sort/memory_management)
- [内存管理\_HZero-CSDN 博客](https://blog.csdn.net/jasonactions/category_10652690.html?spm=1001.2014.3001.5482) 有许多配图，非常棒！
- [内存管理\_bin_linux96 的专栏-CSDN 博客](https://blog.csdn.net/bin_linux96/category_7457811.html)
- [linux 内存\_菁的博客-CSDN 博客](https://blog.csdn.net/u010923083/category_10971696.html)
- 🌟 [内存管理 | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/nei-cun-guan-li)
- 🌟 [bin 的技术小屋 - 知乎](https://www.zhihu.com/column/c_1550511492654600192)
  长文，很多图。**建议看这个！！**
- 🌟 https://github.com/gatieme/LDD-LinuxDeviceDrivers/tree/master/study/kernel/02-memory
- 🌟 [Linux 内存管理专题 - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/8051674.html)
  内容多，而且讲的很容易懂
- http://www.biscuitos.cn/blog/BiscuitOS_Catalogue/
- [tolimit - 博客园](https://www.cnblogs.com/tolimit)
- [embedded guy 专栏文章目录 - 知乎](https://zhuanlan.zhihu.com/p/407097615)

## 代码行数统计

<details>

<summary>v6.11.0 总计 198,813 lines</summary>

```bash
$ tokei mm -f -s lines -t C,'C Header'
===============================================================================
 Language                    Files      Lines       Code   Comments     Blanks
===============================================================================
 C                             161     192763     122995      43351      26417
-------------------------------------------------------------------------------
 mm/hugetlb.c                            7683       4772       1905       1006
 mm/vmscan.c                             7598       4494       1813       1291
 mm/slub.c                               7445       4980       1305       1160
 mm/page_alloc.c                         7143       4226       1923        994
 mm/memory.c                             6925       4412       1760        753
 mm/memcontrol.c                         5448       3441       1175        832
 mm/shmem.c                              5376       3943        780        653
 mm/vmalloc.c                            5212       3130       1291        791
 mm/filemap.c                            4459       2518       1441        500
 mm/huge_memory.c                        4226       3041        615        570
 mm/swapfile.c                           4035       3160        487        388
 mm/ksm.c                                3845       2461        924        460
 mm/gup.c                                3718       2076       1211        431
 mm/mempolicy.c                          3561       2384        738        439
 mm/percpu.c                             3406       1920       1044        442
 mm/compaction.c                         3357       1916        937        504
 mm/page-writeback.c                     3237       1719       1138        380
 mm/memcontrol-v1.c                      3088       2145        542        401
 mm/memory-failure.c                     2831       1738        751        342
 mm/khugepaged.c                         2814       1948        529        337
 mm/rmap.c                               2765       1538        911        316
 mm/migrate.c                            2713       1718        662        333
 mm/mm_init.c                            2675       1705        566        404
 mm/memblock.c                           2435       1340        775        320
 mm/memory_hotplug.c                     2434       1422        654        358
 mm/vmstat.c                             2335       1589        400        346
 mm/mmap.c                               2326       1470        524        332
 mm/damon/sysfs-schemes.c                2309       1809        120        380
 mm/zsmalloc.c                           2307       1517        399        391
 mm/kmemleak.c                           2253       1352        616        285
 mm/damon/core.c                         2222       1499        418        305
 mm/vma.c                                2068       1174        624        270
 mm/kasan/kasan_test_c.c                 2044       1338        285        421
 mm/userfaultfd.c                        1933       1306        382        245
 mm/damon/sysfs.c                        1885       1414        171        300
 mm/nommu.c                              1807       1151        390        266
 mm/zswap.c                              1767       1073        430        264
 mm/madvise.c                            1548       1097        255        196
 mm/z3fold.c                             1447       1032        232        183
 mm/debug_vm_pgtable.c                   1400        956        219        225
 mm/slab_common.c                        1330        837        297        196
 mm/oom_kill.c                           1261        755        350        156
 mm/kfence/core.c                        1260        753        290        217
 mm/util.c                               1237        679        396        162
 mm/backing-dev.c                        1220        896        119        205
 mm/mremap.c                             1186        757        267        162
 mm/damon/dbgfs.c                        1148        901         74        173
 mm/swap.c                               1108        612        351        145
 mm/mmu_notifier.c                       1099        609        378        112
 mm/memory-tiers.c                        995        597        270        128
 mm/page_owner.c                          974        707        104        163
 mm/migrate_device.c                      965        581        261        123
 mm/swap_state.c                          940        611        219        110
 mm/sparse.c                              939        638        171        130
 mm/hugetlb_cgroup.c                      933        729         85        119
 mm/mprotect.c                            915        623        171        121
 mm/pagewalk.c                            858        563        209         86
 mm/kfence/kfence_test.c                  855        595        131        129
 mm/workingset.c                          843        370        385         88
 mm/truncate.c                            841        440        316         85
 mm/highmem.c                             825        520        188        117
 mm/mlock.c                               822        558        140        124
 mm/shrinker.c                            809        520        163        126
 mm/readahead.c                           806        406        319         81
 mm/damon/vaddr.c                         735        514        118        103
 mm/hugetlb_vmemmap.c                     721        393        228        100
 mm/kmsan/kmsan_test.c                    717        484        134         99
 mm/kasan/report.c                        681        456        118        107
 mm/page_io.c                             652        488         88         76
 mm/page_isolation.c                      642        301        275         66
 mm/kasan/shadow.c                        631        356        178         97
 mm/mempool.c                             616        361        188         67
 mm/list_lru.c                            614        463         59         92
 mm/hmm.c                                 609        419        116         74
 mm/cma.c                                 604        381        128         95
 mm/kasan/generic.c                       583        405         78        100
 mm/numa_memblks.c                        571        317        170         84
 mm/numa_emulation.c                      571        357        137         77
 mm/kasan/common.c                        561        352         98        111
 mm/page_ext.c                            551        342        131         78
 mm/damon/paddr.c                         541        423         26         92
 mm/memremap.c                            530        356        104         70
 mm/dmapool.c                             524        338        110         76
 mm/kasan/init.c                          504        391         28         85
 mm/vmpressure.c                          481        236        194         51
 mm/sparse-vmemmap.c                      478        342         68         68
 mm/mmu_gather.c                          471        276        125         70
 mm/page_counter.c                        463        198        213         52
 mm/show_mem.c                            455        367         39         49
 mm/zbud.c                                455        225        180         50
 mm/kmsan/hooks.c                         439        324         71         44
 mm/memfd.c                               424        286         78         60
 mm/page_reporting.c                      417        214        132         71
 mm/kasan/quarantine.c                    414        263         84         67
 mm/percpu-vm.c                           410        201        161         48
 mm/kasan/hw_tags.c                       405        240         96         69
 mm/kasan/report_generic.c                399        281         51         67
 mm/gup_test.c                            395        324          9         62
 mm/kmsan/core.c                          394        296         59         39
 mm/pgtable-generic.c                     382        258         87         37
 mm/zpool.c                               355        144        173         38
 mm/swap_slots.c                          353        227         85         41
 mm/shmem_quota.c                         351        249         54         48
 mm/page_vma_mapped.c                     348        217        101         30
 mm/damon/reclaim.c                       344        201         90         53
 mm/damon/lru_sort.c                      340        209         74         57
 mm/mapping_dirty_helpers.c               339        166        136         37
 mm/kmsan/instrumentation.c               334        215         77         42
 mm/kfence/report.c                       331        227         56         48
 mm/kmsan/shadow.c                        310        236         31         43
 mm/process_vm_access.c                   305        188         82         35
 mm/debug.c                               302        244         21         37
 mm/early_ioremap.c                       297        223         28         46
 mm/secretmem.c                           295        215         18         62
 mm/page_table_check.c                    285        214         19         52
 mm/mincore.c                             283        182         72         29
 mm/shrinker_debug.c                      279        217          5         57
 mm/usercopy.c                            277        160         79         38
 mm/mseal.c                               268        134         97         37
 mm/balloon_compaction.c                  250        124        100         26
 mm/kmsan/init.c                          238        153         58         27
 mm/percpu-stats.c                        235        157         40         38
 mm/swap_cgroup.c                         233        159         42         32
 mm/maccess.c                             230        143         56         31
 mm/fadvise.c                             229        144         52         33
 mm/page_idle.c                           221        160         33         28
 mm/kmsan/report.c                        221        171         29         21
 mm/cma_debug.c                           197        150          7         40
 mm/ptdump.c                              187        137          9         41
 mm/shuffle.c                             182        101         54         27
 mm/kasan/sw_tags.c                       176        113         36         27
 mm/dmapool_test.c                        148        122          0         26
 mm/kasan/tags.c                          148        104         17         27
 mm/execmem.c                             143        108         11         24
 mm/memtest.c                             137        111          4         22
 mm/percpu-km.c                           130         76         30         24
 mm/bootmem_info.c                        128         82         22         24
 mm/cma_sysfs.c                           127         98          6         23
 mm/damon/ops-common.c                    121         76         22         23
 mm/hwpoison-inject.c                     114         75         15         24
 mm/msync.c                               114         77         32          5
 mm/mmzone.c                              113         75         20         18
 mm/mmap_lock.c                           111         77         14         20
 mm/interval_tree.c                       111         88          7         16
 mm/kasan/report_tags.c                   107         52         35         20
 mm/damon/sysfs-common.c                  107         75          9         23
 mm/page_poison.c                         105         79          8         18
 mm/kasan/report_sw_tags.c                 95         61         18         16
 mm/folio-compat.c                         94         75          5         14
 mm/kasan/kasan_test_module.c              81         51         11         19
 mm/failslab.c                             76         53          8         15
 mm/ioremap.c                              74         52         11         11
 mm/kasan/report_hw_tags.c                 71         38         22         11
 mm/numa.c                                 69         52          5         12
 mm/fail_page_alloc.c                      69         53          2         14
 mm/init-mm.c                              57         41         11          5
 mm/debug_page_ref.c                       55         46          1          8
 mm/rodata_test.c                          52         32         12          8
 mm/debug_page_alloc.c                     51         40          1         10
 mm/damon/modules-common.c                 42         24         11          7
 mm/io-mapping.c                           29         13         12          4
-------------------------------------------------------------------------------
 C Header                       24       6050       3887       1200        963
-------------------------------------------------------------------------------
 mm/internal.h                           1446        816        430        200
 mm/slab.h                                696        481        119         96
 mm/kasan/kasan.h                         661        440         85        136
 mm/vma.h                                 558        376         96         86
 mm/damon/tests/core-kunit.h              541        393         57         91
 mm/damon/tests/vaddr-kunit.h             324        191         93         40
 mm/percpu-internal.h                     288        162         80         46
 mm/swap.h                                209        162         15         32
 mm/kmsan/kmsan.h                         188         99         59         30
 mm/damon/tests/dbgfs-kunit.h             173        128         11         34
 mm/memcontrol-v1.h                       159        106         16         37
 mm/kfence/kfence.h                       146         63         56         27
 mm/damon/tests/sysfs-kunit.h              86         61          6         19
 mm/hugetlb_vmemmap.h                      77         51         16         10
 mm/damon/sysfs-common.h                   67         40          9         18
 mm/cma.h                                  58         47          5          6
 mm/mm_slot.h                              55         39          7          9
 mm/shuffle.h                              53         44          2          7
 mm/page_reporting.h                       53         33         13          7
 mm/pgalloc-track.h                        51         42          1          8
 mm/vma_internal.h                         49         37          7          5
 mm/damon/modules-common.h                 49         36          6          7
 mm/gup_test.h                             45         32          5          8
 mm/damon/ops-common.h                     18          8          6          4
===============================================================================
 Total                         185     198813     126882      44551      27380
===============================================================================
```

</details>
