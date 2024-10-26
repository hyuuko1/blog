# TODO node, zone 的概念, 物理内存布局

- [Physical Memory — The Linux Kernel documentation](https://docs.kernel.org/mm/physical_memory.html)

## `struct pglist_data`

`struct pglist_data` 描述了一个内存节点。都记录在了 node_data 数组内。

```cpp
// mm/numa.c
struct pglist_data *node_data[MAX_NUMNODES];

// include/linux/numa.h
/* 给定 node id，获取 struct pglist_data */
#define NODE_DATA(nid)	(node_data[nid])
```

初始化：

```cpp
start_kernel->setup_arch
  initmem_init->x86_numa_init
    numa_init()
      numa_memblks_init()
      numa_register_nodes()
        for_each_node_mask(nid, node_possible_map)
          alloc_node_data(nid)
            /* 分配 struct pglist_data 记录在 node_dadta 数组中 */
            nd_pa = memblock_phys_alloc_try_nid(nd_size, SMP_CACHE_BYTES, nid);
            nd = __va(nd_pa);
            node_data[nid] = nd;
```

```bash
$ numactl -H
available: 2 nodes (0-1)
node 0 cpus: 0 1
node 0 size: 3915 MB
node 0 free: 3834 MB
node 1 cpus: 2 3
node 1 size: 4028 MB
node 1 free: 4004 MB
node distances:
node   0   1
  0:  10  20
  1:  20  10
```

## node 被分为多个 zone

这是为什么呢？

因为实际的计算机体系结构有硬件的诸多限制, 这限制了页框可以使用的方式. 尤其是, Linux 内核必须处理 80x86 体系结构的两种硬件约束.

- ISA 总线的直接内存存储 DMA 处理器有一个严格的限制 : 他们只能对 RAM 的前 16MB 进行寻址
- 在具有大容量 RAM 的现代 32 位计算机中, CPU 不能直接访问所有的物理地址, 因为线性地址空间太小, 内核不可能直接映射所有物理内存到线性地址空间, 我们会在后面典型架构(x86)上内存区域划分详细讲解 x86_32 上的内存区域划分

因此 Linux 内核对不同区域的内存需要采用不同的管理方式和映射方式, 因此内核将物理地址或者成用 zone_t 表示的不同地址区域

```cpp
typedef struct pglist_data {
  /* 本内存节点的 zone，
     MAX_NR_ZONES 的值等于 enum zone_type 里的 __MAX_NR_ZONES */
  struct zone node_zones[MAX_NR_ZONES];
  /* 备用 node（系统中的所有 node） */
  struct zonelist node_zonelists[MAX_ZONELISTS];
} pg_data_t;


/* zone 的类型 */
enum zone_type {
/*  */
#ifdef CONFIG_ZONE_DMA
  ZONE_DMA,
#endif

/*  */
#ifdef CONFIG_ZONE_DMA32
  ZONE_DMA32,
#endif

/*  */
  ZONE_NORMAL,

/*
   X86_64 不会启用这个 */
#ifdef CONFIG_HIGHMEM
  ZONE_HIGHMEM,
#endif

/*  */
  ZONE_MOVABLE,

/*  */
#ifdef CONFIG_ZONE_DEVICE
  ZONE_DEVICE,
#endif

  __MAX_NR_ZONES
}


// include/generated/bounds.h
/* MAX_NR_ZONES 这个宏是在一个被自动生成的头文件里定义的，值等于 __MAX_NR_ZONES */
#define MAX_NR_ZONES 5 /* __MAX_NR_ZONES */


struct zone {
  struct per_cpu_pages    __percpu *per_cpu_pageset;
  struct per_cpu_zonestat __percpu *per_cpu_zonestats;
};
```
