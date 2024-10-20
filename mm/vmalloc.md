---
description: vmalloc 和 vmap 代码分析，演进历史
head:
  - - meta
    - name: keywords
      content: vmalloc, vmap, kernel, 内存分配
---

# vmalloc: 不连续物理内存分配与 vmap

## 参考

- [【原创】（十二）Linux 内存管理之 vmap 与 vmalloc - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11965787.html)
- [Linux 内存管理 (6)vmalloc - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/8251333.html)

## 概览

vmalloc 的核心是在 vmalloc 区域中找到合适的 hole，hole 是虚拟地址连续的；然后逐页分配内存来从物理上填充 hole。

vmalloc 的 gfp_maks 和逐页分配就决定了它的属性：

- 可能睡眠：不能从中断上下文中调用，或其他不允许阻塞情况下调用。
- 虚拟地址连续：要建立页表，开销比 kmalloc 大
- 物理地址不连续：要多次分配页面，开销比 kmalloc 大
- size 对齐到页：不适合小内存分配

分配得到的虚拟地址在[虚拟地址空间布局](./layout.md)中的“vmalloc/ioremap space”区域，`[ffffc90000000000, ffffe8ffffffffff]` 32 TB。

**关键流程**

1. 在 vmalloc/ioremap space 区域分配一个连续虚拟地址空间
2. 从 Buddy System 多次分配 order 为 0 的页面，这些页面不连续。
3. 通过 vmap 机制，连续的虚拟地址映射到不连续的物理页面。

## vmap

vmalloc 基于 vmap，先来介绍 vmap。

在内核的的 vmalloc 区域中，选取一段连续的虚拟地址区域，映射到 page 数组代表的不连续物理页面，返回虚拟地址。

```cpp
void *vmap(struct page **pages, unsigned int count, unsigned long flags, pgprot_t prot);
```

### vmap 应用场景

1. per_cpu 的 hardirq stack

   代码路径：`start_kernel->init_IRQ->irq_init_percpu_irqstack->map_irq_stack`

2. dma-buf。

   详见 [dma-buf](./dma_buf.md)

```bash
sudo bpftrace -e 'kfunc:vmlinux:__vmalloc_node_range_noprof  { @[kstack] = count(); }'

@[
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+6685
    bpf_prog_6deef7357e7b4530_sd_fw_ingress+6685
    bpf_trampoline_6442530470+111
    __vmalloc_node_range_noprof+9
    # dup_task_struct alloc_thread_stack_node
    copy_process+3049
    kernel_clone+189
    __do_sys_clone3+228
    do_syscall_64+130
    entry_SYSCALL_64_after_hwframe+118
]: 35
```

### 数据结构

```cpp
static LIST_HEAD(free_vmap_area_list);
/* 空闲的 vmalloc 区域 */
static struct rb_root free_vmap_area_root = RB_ROOT;

/* 用于描述一段虚拟地址的区域 */
struct vmap_area {
	unsigned long va_start;
	unsigned long va_end;

	/* 属于以下 3 个红黑树之一：
	   - free_vmap_area_root。表明还未分配出去？
	   - vmap_node 的 busy。表明已被分配出去
	   - vmap_node 的 lazy。表明正在 lazy 释放的阶段？
	 */
	struct rb_node rb_node;
	/* 同 rb_node，属于 3 个链表之一，free_vmap_area_list、busy、lazy */
	struct list_head list;

	union {
		unsigned long subtree_max_size;
		struct vm_struct *vm;	/* 指向一个 vm_struct 单向链表 */
	};
	unsigned long flags; /* mark type of vm_map_ram area */
};

/* 管理虚拟地址和物理页之间的关系 */
struct vm_struct {
	struct vm_struct	*next;		/* 串成一个单向链表 */
	void			*addr;
	unsigned long		size;
	unsigned long		flags;
	struct page		**pages;
#ifdef CONFIG_HAVE_ARCH_HUGE_VMALLOC
	unsigned int		page_order;
#endif
	unsigned int		nr_pages;
	phys_addr_t		phys_addr;
	const void		*caller;
};


/*
  定义在 mm/vmalloc.c 里
 */
static struct vmap_node {
	/* Simple size segregated storage. */
	struct vmap_pool pool[MAX_VA_SIZE_PAGES];
	spinlock_t pool_lock;
	bool skip_populate;

	/*  */
	struct rb_list busy;
	/* vunmap 的 vmap_area 会先挂在这颗红黑树上，等待被释放 */
	struct rb_list lazy;

	/*
	 * Ready-to-free areas.
	 */
	struct list_head purge_list;
	struct work_struct purge_work;
	unsigned long nr_purged;
};
```

### vmap 代码分析

```cpp
vmap()
  struct vm_struct *area = get_vm_area_caller()->__get_vm_area_node()
    BUG_ON(in_interrupt()); /* 不能在中断上下文使用 */
    struct vm_struct *area = kzalloc_node()
    /* 分配一个 vmap_area */
    struct vmap_area *va = alloc_vmap_area(..., area)
      /* 优先从 vmap_pool 分配 vmap_area */
      va = node_alloc();
      /* 否则从 slab 分配 */
      if (!va) va = kmem_cache_alloc_node(vmap_area_cachep);
      /* 如果不是从 vmap_pool 分配的，还需要这一步分配一个虚拟地址出来  */
      __alloc_vmap_area() /* TODO 这个还没分析 */
      	find_vmap_lowest_match()
	va_alloc()
      /* 将 vmap_area 放进 vmap_node 的 busy 红黑树和链表 */
      struct vmap_node *vn = addr_to_node(va->va_start);
  vmap_pages_range(area->addr, .., pages)
  return area->addr;
```

接下来分析 vmap 演进历史中几个比较重要的 patch。

#### [\[patch\] mm: rewrite vmap layer - Nick Piggin](https://lore.kernel.org/linux-mm/20080818133224.GA5258@wotan.suse.de/)

db64fe02258f1507e13fe5212a989922323685ce mm: rewrite vmap layer

重写了 vmap

存在的问题：

1. vmap 最大的问题是 vunmap。目前需要一个 global kernel TLB flush，在大多数架构上，是一个广播给所有 CPU 的用于 flush cache 的 IPI，而且需要用一个全局锁。随着 CPU 数量增加，有伸缩性问题。
2. 另一个问题是，整个 vmap 用了一个读写锁，而这个读写锁很少读并行，大多数时候是在 fast path 进行写。

解决方式：

1. lazy TLB unmapping。在 vunmap 后，不会立即 flush TLB。而是在某次 TLB flush 时，同时 flush 多个 vunmap 的地址。XEN 和 PAT 不会这样做，原因我懒得看。
2. 虚拟地址的额外信息保存在红黑树里，提升算法可伸缩性。
3. 对于小的 vmap，使用 per-cpu 的分配器，避免全局锁。

#### [\[PATCH v3 00/11\] Mitigate a vmap lock contention v3 - Uladzislau Rezki (Sony)](https://lore.kernel.org/all/20240102184633.748113-1-urezki@gmail.com/)

1. d093602919ad mm: vmalloc: remove global vmap_area_root rb-tree

   大锁化小锁，减少锁争用。

   引入 `struct vmap_node`，对于不同范围内的虚拟地址，通过 `addr_to_node(va)` 函数，使用不同的 `struct vmap_node`，从而减少锁争用。
   将原先全局的 `vmap_area_root` 红黑树（用于记录已被使用的 vmap_area），改为 per-vmap_node 的 `busy` 红黑树。
   将原先全局的 `vmap_area_lock` 锁，改为 per-vmap_node 的锁。

2. 282631cb2447 mm: vmalloc: remove global purge_vmap_area_root rb-tree

   大锁化小锁，减少锁争用。

   将原先全局的 `purge_vmap_area_root` 红黑树（用于记录。。。），改为 per-vmap_node 的 `lazy` 红黑树。
   将原先全局的 `purge_vmap_area_lock` 锁，改为了 per-vmap_node 的锁。减少了锁争用。

3. 72210662c5a2 mm: vmalloc: offload free_vmap_area_lock lock

   减少对 `free_vmap_area_lock` 锁的争用。

   在每个 `struct vmap_node` 内新增 `struct vmap_pool` 数组，将不同大小的空闲的 `struct vmap_area` 放在不同的池子里进行缓存。

   在 `alloc_vmap_area()` 时，只有对应的 vmap_pool 空了时，才会通过 `kmem_cache_alloc_node()` 从 SLUB 中分配 `struct vmap_area`。如果成功从 vmap_pool 中分配了，虽说分配时需要占用 per-vmap_node 的 pool_lock，但后面不需要 `__alloc_vmap_area()`，因此省去了对 `free_vmap_area_lock` 这个大锁的争用。

   用于 lazy TLB vunmap 的 `__purge_vmap_area_lazy()` 函数，会从 lazy 链表中的 va 移动到 purge_list，如果需要移除的 va 较多，则使用 work queue 处理，否则直接就地 `purge_vmap_node()` 将 va 放回 vmap_pool，如果 vmap_pool 满了，则放回全局的 free_vmap_area_root 红黑树和 free_vmap_area_list 链表。

4. 53becf32aec1 mm: vmalloc: support multiple nodes in vread_iter
5. 8e1d743f2c26 mm: vmalloc: support multiple nodes in vmallocinfo
6. 8f33a2ff3072 mm: vmalloc: set nr_nodes based on CPUs in a system

   此时才会真正地用上多个 vmap_node

7. 7679ba6b36db mm: vmalloc: add a shrinker to drain vmap pools

   注册了一个 shrinker，用于在必要时缩小 vmap pool

这是一个很典型的内存管理中锁的典型优化案例，其他案例：

- [Linux 内存管理中锁使用分析及典型优化案例总结](https://blog.csdn.net/feelabclihu/article/details/141087096)
- [Linux 内核的 blk-mq（Block IO 层多队列）机制 | Caturra's Blog](https://www.bluepuni.com/archives/linux-blk-mq/)

## vmalloc

接口在 `include/linux/vmalloc.h`

`vmalloc()` 默认使用 `GFP_KERNEL` 如果想指定 gfp_mask，应使用 `__vmalloc()`
`vmalloc_huge()` 如果可以，会分配大页。

最终都会调用到核心函数 `__vmalloc_node_range_noprof()`

noprof 是指 no protection flags。protection flags 是指 `PAGE_KERNEL` 这种，

```cpp
__vmalloc_node_range_noprof
  struct vm_struct *area = __get_vm_area_node()
  /* 分配页面并 vmap */
  __vmalloc_area_node()
    vm_area_alloc_pages()->alloc_pages_bulk_array_mempolicy_noprof()
      alloc_pages_bulk_noprof() /* 分配 0 阶页面 */
    vmap_pages_range()->..->vmap_small_pages_range_noflush()
```

可以看到，与 vmap 的流程相比，vmalloc 只多出了一个 `alloc_pages_bulk_noprof()` 分配内存的动作，该函数详见 [buddy system](./buddy.md)。

## 想水 patch 了

1. `struct vmap_area` 的注释里的 `vmap_area_root` 现在已经无了
