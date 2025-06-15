# zone

- [一步一图带你深入理解 Linux 物理内存管理 - 知乎](https://zhuanlan.zhihu.com/p/585395024)

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

64 才有 ZONE_DMA32，
32 才有 ZONE_HIGHMEM

```cpp
/* x86_32 平台 */
enum zone_type {
	ZONE_DMA,	/* 0     ~ 16MB  */
	ZONE_NORMAL,	/* 16MB  ~ 896MB */
	ZONE_HIGHMEM,	/* 896MB ~ 4GB   */
	ZONE_MOVABLE,
	ZONE_DEVICE,
	__MAX_NR_ZONES /* 5 */
};

/* x86_64 平台 */
enum zone_type {
	ZONE_DMA,	/* 0     ~ 16MB  */
	ZONE_DMA32,	/* 16MB  ~ 4GB */
	ZONE_NORMAL,	/* 4GB   ~ 128TB */
	ZONE_MOVABLE,
	ZONE_DEVICE,
	__MAX_NR_ZONES /* 5 */
}
```
