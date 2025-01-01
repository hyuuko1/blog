# hugetlb 大页内存

## 参考

- 《Linux 内核深度解析》3.13 巨型页
- [HugeTLB Pages — The Linux Kernel documentation](https://www.kernel.org/doc/html/latest/admin-guide/mm/hugetlbpage.html)

## 概述

引入 Huge Page 的直接原因：大幅减少 TLB miss 和缺页异常的数量，大幅提高应用程序的性能。

目前内核里有两种 Huge Page 的实现方式：

1. 标准大页 Huge Page
   - 优点：进程申请时，从大页内存池申请，成功率很高。
   - 缺点：需要预先分配大页内存，而且需要应用程序配合主动申请。
2. 透明大页 Transparent Huage Page
   - 优点：对应用程序透明。
   - 缺点：动态分配，内存碎片化的时候分配成功的概率低。

本文只讲标准大页，透明大页见 [thp](./thp.md)。

先解释下几个名词：

- Persistent Huge Pages 持久大页。
  是通过内核命令行参数或者 `/proc` 或 `/sys` 预先分配的大页，它们在系统运行期间始终存在，并且在释放时会返回到 huge page 池中。
- Surplus Huge Pages 多余大页。
  这些是超出系统配置的 huge pages 数量的额外 huge pages。它们是在运行时动态分配的，当系统不再需要时可以被释放
- Reserved Huge Pages 保留大页。
  这些是已经承诺从 huge page 池中分配但尚未实际分配的 huge pages，比如 mmap 后，还未发生 pagefault 的场景。保留大页保证应用程序在需要时能够从 huge page 池中分配到 huge pages。
- Free Huge Pages 空闲大页。
  这些是当前未被分配的 huge pages。

## 使用方法

### 准备工作：预先分配大页内存

方法二：内核命令行参数 `hugepages=N`，这是分配巨型页最可靠的方法，因为内存还没有碎片化。

有些平台支持多种大页长度。如果要分配特定长度的大页，必须在内核参数 `hugepages=N` 前面添加选择巨型页长度的参数 `hugepagesz=<size>[kKmMgG]`。可以使用参数 `default_hugepagesz=<size>[kKmMgG]` 选择默认的大页大小。

方法二：通过文件系统接口 `/proc` 或 `/sys` 来预先分配指定数量的大页。

```bash
# 设置默认大小的大页的数量。等同于 sudo sysctl -w vm.nr_hugepages=数量
$ echo 数量 | sudo tee /proc/sys/vm/nr_hugepages
# 设置 2MB 大页的数量
$ echo 数量 | sudo tee /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
# 设置 1GB 大页的数量
$ echo 数量 | sudo tee /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages

# 在分配了 1 个 2MB 大页和 1 个 1GB 大页后，来看统计信息
$ cat /proc/meminfo | grep Huge
# 只显示了默认大小的大页的数量
HugePages_Total:       1
HugePages_Free:        1
HugePages_Rsvd:        0	# 预留的
HugePages_Surp:        0	# 多余的
Hugepagesize:       2048 kB	# 默认大小
# 1050624 = 1048576 + 2048
Hugetlb:         1050624 kB
```

2MB 和 1GB 大页是能同时存在的，之前一直以为不能。。。

除了 `nr_hugepages` 文件系统接口以外，还有 `nr_overcommit_hugepages` 用于指定，当大页用完后，允许 overcommit 的大页数量，overcommit 的大页在释放时，会被直接释放到 buddy system，不会被释放到大页内存池中。

### 匿名大页映射

代码见本仓库的 src/mm/user/test_mmap_hugetlb.c

### hugetlbfs 文件大页映射

代码见本仓库的 src/mm/user/test_mmap_hugetlb.c

### 使用 hugetlbfs 库

<https://github.com/libhugetlbfs/libhugetlbfs> 对 hugetlbfs 文件系统做了封装。使用 hugetlbfs 库的好处如下：

1. 启动程序时使用环境变量 `LD_PRELOAD=libhugetlbfs.so` 把 hugetlbfs 库设置成优先级最高的动态库，`malloc()` 使用巨型页，对应用程序完全透明，应用程序不需要修改代码。
2. 可以把代码段、数据段和未初始化数据段都放在巨型页中。

## 实现原理

### 数据结构

内核使用大页内存池管理大页，数据结构是 `struct hstate`。

```cpp
int hugetlb_max_hstate __read_mostly;
unsigned int default_hstate_idx;
/* 在 x86 架构是 2，只存在 2MB 和 1GB 两种大页
   在 arm64 架构是 4，存在 64KB、2MB、32MB 和 1GB 四种大页 */
struct hstate hstates[HUGE_MAX_HSTATE];

struct hstate {
	struct mutex resize_lock;
	struct lock_class_key resize_key;
	/* 分配永久巨型页并添加到巨型页池中的时候，在允许的内存节点集合中轮流从每个内存节点
	   分配永久巨型页，这个成员用来记录下次从哪个内存节点分配永久巨型页 */
	int next_nid_to_alloc;
	/* 从巨型页池释放空闲巨型页的时候，在允许的内存节点集合中轮流从每个内存节点释放巨型页，
	   这个成员用来记录下次从哪个内存节点释放巨型页 */
	int next_nid_to_free;
	/* 阶数。0 阶是 4KB */
	unsigned int order;
	unsigned int demote_order;
	/* 页号掩码。虚拟地址按位与操作，得到页号 */
	unsigned long mask;
	/* 持久大页的最大数量 */
	unsigned long max_huge_pages;
	/* 大页的数量（持久大页 + 多余大页）
	   /sys/kernel/mm/hugepages/hugepages-XXX/nr_hugepages */
	unsigned long nr_huge_pages;
	/* 空闲大页的数量
	   /sys/kernel/mm/hugepages/hugepages-XXX/free_hugepages */
	unsigned long free_huge_pages;
	/* 保留大页的数量，已经承诺分配，但还没有分配，比如 mmap 了，但还没有发生 pagefault
	   /sys/kernel/mm/hugepages/hugepages-XXX/resv_hugepages */
	unsigned long resv_huge_pages;
	/* 多余大页的数量
	   /sys/kernel/mm/hugepages/hugepages-XXX/surplus_hugepages */
	unsigned long surplus_huge_pages;
	/* 多余大页的最大数量
	   /sys/kernel/mm/hugepages/hugepages-XXX/nr_overcommit_hugepages */
	unsigned long nr_overcommit_huge_pages;
	/* 已分配出去的 */
	struct list_head hugepage_activelist;
	/* 空闲的 */
	struct list_head hugepage_freelists[MAX_NUMNODES];
	unsigned int max_huge_pages_node[MAX_NUMNODES];
	unsigned int nr_huge_pages_node[MAX_NUMNODES];
	unsigned int free_huge_pages_node[MAX_NUMNODES];
	unsigned int surplus_huge_pages_node[MAX_NUMNODES];
	/* 巨型页池的名称，格式是 hugepages-<size>kB */
	char name[HSTATE_NAME_LEN];
};
```

### 系统启动时大页内存池的初始化

先来看初始化部分

1. 首先是一些内核命令行参的解析。由 `__setup` 定义的参数，是会发生在 memblock 初始化完毕之后的，其具体的执行时机见另一篇文章 [initcall.md](../init/initcall.md)
2. 然后是 hugetlb subsystem 的初始化。
3. 最后会在内核线程里完成对 hstate 大页内存池的初始化。

```cpp
/* 内核命令行参数。设置大页的 page size */
__setup("hugepagesz=", hugepagesz_setup);
__setup("default_hugepagesz=", default_hugepagesz_setup);
/* 内核命令行参数。设置大页的数量，会为大页预先申请内存 */
__setup("hugepages=", hugepages_setup);
  /* 一系列操作，会修改 hstate 里的 max_huge_pages */
  ...
  /* 如果前面有 hugepagesz= 指定了 size，并且 buddy system 无法分配该 size 的，则现在就
     从 memblock 分配。而那些可以由 buddy system 分配的，会在后面 hugetlb 子系统初始化时分配 */
  if (hugetlb_max_hstate && hstate_is_gigantic(parsed_hstate))
    hugetlb_hstate_alloc_pages(parsed_hstate)->...->alloc_bootmem_huge_page()
    /* 从 memblock 里分配页面，然后放到 huge_boot_pages 链表 */
    struct huge_bootmem_page *m = memblock_alloc_try_nid_raw()
    list_add(&m->list, &huge_boot_pages[node]);

/* hugetlb 子系统初始化。会拉起线程去执行 gather_bootmem_prealloc_parallel 函数，
   TODO 为什么需要拉起内核线程去完成这个事？ */
subsys_initcall(hugetlb_init);
  hugetlb_add_hstate(HUGETLB_PAGE_ORDER);
  hugetlb_init_hstates();
    /* 在 early boot 阶段只为 gigantic 的 huge page 分配了内存，现在为其他的进行分配，
       会在内核线程中通过 buddy system 为 huge page 申请内存，并放进 hstate 大页内存池 */
    for_each_hstate(h) if (!hstate_is_gigantic(h)) hugetlb_hstate_alloc_pages(h);
  gather_bootmem_prealloc();
    job.thread_fn = gather_bootmem_prealloc_parallel;
    padata_do_multithreaded(&job);
/* 在内核线程里 */
gather_bootmem_prealloc_parallel()->gather_bootmem_prealloc_node()
  list_for_each_entry(m, &huge_boot_pages[nid], list)
    struct hstate *h = m->hstate;
    prep_and_add_bootmem_folios()
      /* 将 folio 放进 hstate 大页内存池 */
      enqueue_hugetlb_folio()
        list_move(&folio->lru, &h->hugepage_freelists[nid]);
        h->free_huge_pages++;
        h->free_huge_pages_node[nid]++;
    hugetlb_folio_init_vmemmap()
```

### 通过 /proc /sys 预分配大页内存

```cpp
/* 用户态接口 /proc/sys/vm/nr_hugepages */
HSTATE_ATTR(nr_hugepages);
nr_hugepages_store()->nr_hugepages_store_common()->__nr_hugepages_store_common()
  set_max_huge_pages(h, count) /* count 是设置下来的大页数量 */
    /* 如果持久大页数量不满足 count，则将 surplus 大页转为持久大页。
       这里只是把 h->surplus_huge_pages_node[node] 给 -1 了，并对 hugepage_freelists 做什么操作，
       是因为并不需要吗？ */
    while (h->surplus_huge_pages && count > persistent_huge_pages(h))
      if (!adjust_pool_surplus(h, nodes_allowed, -1)) break;
    /* 预分配新的大页，作为持久大页 */
    while (count > (persistent_huge_pages(h) + allocated))
      folio = alloc_pool_huge_folio()
      list_add(&folio->lru, &page_list);
      allocated++;
    /* 将刚才预分配的大页，放进大页内存池 */
    prep_and_add_allocated_folios(h, &page_list);
    /* min_count = 大页总数 - (空闲大页数 - 保留大页数)。也就是：已经被应用程序申请的大页数。
       这其中，包含了多余大页，也包含被应用程序预定的，比如 mmap 了，但还未 pagefault */
    min_count = h->resv_huge_pages + h->nr_huge_pages - h->free_huge_pages;
    /* min_count 此时的含义就是：大页内存池至少有 min_count 个持久大页即可 */
    min_count = max(count, min_count);
    /* 如果持久大页数量超过了 min_count，就尽量将空闲大页释放一些 */
    while (min_count < persistent_huge_pages(h))
      folio = remove_pool_hugetlb_folio(h, nodes_allowed, 0);
      list_add(&folio->lru, &page_list);
    update_and_free_pages_bulk(h, &page_list);
    /* 如果持久大页数量，仍然大于我们要设置成的数量，那就把一些持久大页转换为多余大页
       TODO 会存在中途 break 的情况吗？ */
    while (count < persistent_huge_pages(h))
      if (!adjust_pool_surplus(h, nodes_allowed, 1)) break;

/* 用户态接口 /sys/kernel/mm/hugepages/hugepages-XXXkB/nr_hugepages */
hugetlb_sysctl_handler()->hugetlb_sysctl_handler_common()->__nr_hugepages_store_common()
  /* 接下来的流程和 /proc/sys/vm/nr_hugepages 是一样的 */
  ...


/* 一个概念：gigantic 大页，是指 order 大于 MAX_PAGE_ORDER 的大页，即，超出了 buddy system
   能分配的大小，无法从 buddy system 分配，一般 MAX_PAGE_ORDER 为 10，也就是 4MB */
static inline bool hstate_is_gigantic(struct hstate *h)
{
	return huge_page_order(h) > MAX_PAGE_ORDER;
}
```

### hugetlbfs

代码在 fs/hugetlbfs/inode.c

hugetlbfs 的挂载没啥好讨论的，每个 `struct hstate` 都有各自的 `struct fs_context` 和 `struct vfsmount` 实例 ，也就有不同的 super block 等等，`hugetlbfs_fill_super()` 会初始化 super block 的一些信息，里面保存了对应的 hstate 相关信息，不同大小的大页就这样彼此区分开来了。

重点分析对外的接口 `hugetlb_file_setup()` 函数，mmap、memfd、shm 等模块会调用这个函数创建一个 hugetlbfs 的 `struct file`。

```cpp
hugetlb_file_setup()
  /* 根据 pagesize 得到对应 hstate 的 struct vfsmount */
  int hstate_idx = get_hstate_idx(page_size_log);
  struct vfsmount *mnt = hugetlbfs_vfsmount[hstate_idx];
  /* 创建 inode */
  struct inode *inode = hugetlbfs_get_inode(mnt->mnt_sb, )
  inode->i_size = size;
  /* 保留大页，还未分配。应该只是修改了几个计数，没修改 freelist。
     TODO 还涉及到 subpool 啥的，暂不细究 */
  hugetlb_reserve_pages(inode, )
  /* 创建伪文件 */
  struct file *file = alloc_file_pseudo(, &hugetlbfs_file_operations)
  return file;

static const struct file_operations hugetlbfs_file_operations = {
	.read_iter		= hugetlbfs_read_iter,
	.mmap			= hugetlbfs_file_mmap,
	.fsync			= noop_fsync,
	.get_unmapped_area	= hugetlb_get_unmapped_area,
	.llseek			= default_llseek,
	.fallocate		= hugetlbfs_fallocate,
	.fop_flags		= FOP_HUGE_PAGES,
};
```

### mmap 匿名大页映射

关于 mmap 详见 [mmap](./mmap.md)，此处只讲标准大页相关的。

```cpp
/* 用户态，注意，带有 MAP_ANONYMOUS | MAP_HUGETLB flags */
mmap(NULL, MAP_HUGE_2MB, PROT_READ | PROT_WRITE, other_flags | MAP_ANONYMOUS | MAP_HUGETLB, 0, 0);

__do_sys_mmap()->ksys_mmap_pgoff()
  struct file *file = hugetlb_file_setup("anon_hugepage", ...)
  /* 由于 file 不是 NULL 所以后面 mmap 的流程里，其实会当作是文件映射来处理 */
  vm_mmap_pgoff(file)->do_mmap()->mmap_region()->__mmap_region()
    mmap_file()->call_mmap()
      file->f_op->mmap:hugetlbfs_file_mmap()

hugetlbfs_file_mmap()
  /* 最核心的就这几行代码 */
  vm_flags_set(vma, VM_HUGETLB | VM_DONTEXPAND | VM_MTE_ALLOWED);
  vma->vm_ops = &hugetlb_vm_ops;
  hugetlb_reserve_pages()
```

### mmap hugetlbfs 文件大页映射

除了 `struct file` 是在 mmap 之前就已经在 open 时创建了，其他地方和 mmap 匿名大页映射流程几乎一样。

### hugetlb_fault()

TODO

```cpp
/* 之前在 mmap 时，设置了这个 vm_ops，但当发生 pagefault 时，实际上这里的 fault 钩子并不会被调用 */
const struct vm_operations_struct hugetlb_vm_ops = {
	.fault = hugetlb_vm_op_fault,
	.open = hugetlb_vm_op_open,
	.close = hugetlb_vm_op_close,
	.may_split = hugetlb_vm_op_split,
	.pagesize = hugetlb_vm_op_pagesize,
};

handle_mm_fault()
  if (is_vm_hugetlb_page(vma)) hugetlb_fault()
    hugetlb_wp()
      alloc_hugetlb_folio()

alloc_hugetlb_folio()
  alloc_buddy_hugetlb_folio_with_mpol()
    alloc_surplus_hugetlb_folio()
      alloc_fresh_hugetlb_folio()
        /* 如果 hstate_is_gigantic，则最终会调用 alloc_contig_range_noprof 函数进行分配，
           否则，会从 buddy system 中分配 */
```

### hugetlb 与 CoW

TODO

## 遗留

- [ ] subpool 是啥
- [ ] 为啥有时 ls /dev/hugepages 看不到文件
