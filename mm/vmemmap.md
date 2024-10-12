# pfn_to_page() 的原理：mem_section 与 vmemmap

前文，我们讨论了 [`struct page`](./page.md)，那怎么根据 pfn 得到对应的 `struct page` 呢？

目前是默认开启了 `CONFIG_SPARSEMEM_VMEMMAP` 的，我这里也会提一下传统的没有用到 vmemmap 的 Sparse Memory Model。

## 参考

- [29.3. Memory Management — The Linux Kernel documentation](https://docs.kernel.org/arch/x86/x86_64/mm.html)
  虚拟内存布局
- [Physical Memory Model — The Linux Kernel documentation](https://docs.kernel.org/mm/memory-model.html)
  FLATMEM, SPARSEMEM 物理内存模型
- [Linux 内存模型 - wowotech](http://www.wowotech.net/memory_management/memory_model.html)
- [【原创】（四）Linux 内存模型之 Sparse Memory Model - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11523678.html)

## 虚拟内存布局

48bit, 4-level, 共 256TB 的虚拟地址空间。

本文主要讨论下表中的 “virtual memory map (vmemmap_base)” 区域。

注意，下表中的 “direct mapping of all physical memory” 这一段，是 64TB，说明 Linux 打算最多支持 64TB 的物理内存，这也可以在代码中得到验证：

```cpp
// arch/x86/include/asm/sparsemem.h
# define MAX_PHYSMEM_BITS	(pgtable_l5_enabled() ? 52 : 46) /* 2^46 就是 64TB */
```

```c
========================================================================================================================
    Start addr    |   Offset   |     End addr     |  Size   | VM area description
========================================================================================================================
                  |            |                  |         |
 0000000000000000 |    0       | 00007fffffffffff |  128 TB | user-space virtual memory, different per mm
__________________|____________|__________________|_________|___________________________________________________________
                  |            |                  |         |
 0000800000000000 | +128    TB | ffff7fffffffffff | ~16M TB | ... huge, almost 64 bits wide hole of non-canonical
                  |            |                  |         |     virtual memory addresses up to the -128 TB
                  |            |                  |         |     starting offset of kernel mappings.
__________________|____________|__________________|_________|___________________________________________________________
                                                            |
                                                            | Kernel-space virtual memory, shared between all processes:
____________________________________________________________|___________________________________________________________
                  |            |                  |         |
 ffff800000000000 | -128    TB | ffff87ffffffffff |    8 TB | ... guard hole, also reserved for hypervisor
 ffff880000000000 | -120    TB | ffff887fffffffff |  0.5 TB | LDT remap for PTI
 ffff888000000000 | -119.5  TB | ffffc87fffffffff |   64 TB | direct mapping of all physical memory (page_offset_base)
 ffffc88000000000 |  -55.5  TB | ffffc8ffffffffff |  0.5 TB | ... unused hole
 ffffc90000000000 |  -55    TB | ffffe8ffffffffff |   32 TB | vmalloc/ioremap space (vmalloc_base)
 ffffe90000000000 |  -23    TB | ffffe9ffffffffff |    1 TB | ... unused hole
 ffffea0000000000 |  -22    TB | ffffeaffffffffff |    1 TB | virtual memory map (vmemmap_base)
 ffffeb0000000000 |  -21    TB | ffffebffffffffff |    1 TB | ... unused hole
 ffffec0000000000 |  -20    TB | fffffbffffffffff |   16 TB | KASAN shadow memory
__________________|____________|__________________|_________|____________________________________________________________
                                                            |
                                                            | Identical layout to the 56-bit one from here on:
____________________________________________________________|____________________________________________________________
                  |            |                  |         |
 fffffc0000000000 |   -4    TB | fffffdffffffffff |    2 TB | ... unused hole
                  |            |                  |         | vaddr_end for KASLR
 fffffe0000000000 |   -2    TB | fffffe7fffffffff |  0.5 TB | cpu_entry_area mapping
 fffffe8000000000 |   -1.5  TB | fffffeffffffffff |  0.5 TB | ... unused hole
 ffffff0000000000 |   -1    TB | ffffff7fffffffff |  0.5 TB | %esp fixup stacks
 ffffff8000000000 | -512    GB | ffffffeeffffffff |  444 GB | ... unused hole
 ffffffef00000000 |  -68    GB | fffffffeffffffff |   64 GB | EFI region mapping space
 ffffffff00000000 |   -4    GB | ffffffff7fffffff |    2 GB | ... unused hole
 ffffffff80000000 |   -2    GB | ffffffff9fffffff |  512 MB | kernel text mapping, mapped to physical address 0
 ffffffff80000000 |-2048    MB |                  |         |
 ffffffffa0000000 |-1536    MB | fffffffffeffffff | 1520 MB | module mapping space
 ffffffffff000000 |  -16    MB |                  |         |
    FIXADDR_START | ~-11    MB | ffffffffff5fffff | ~0.5 MB | kernel-internal fixmap range, variable size and offset
 ffffffffff600000 |  -10    MB | ffffffffff600fff |    4 kB | legacy vsyscall ABI
 ffffffffffe00000 |   -2    MB | ffffffffffffffff |    2 MB | ... unused hole
__________________|____________|__________________|_________|___________________________________________________________
```

## 概览

pfn 即 page frame number，`page_to_pfn(pfn)` 可以得到 pfn 页帧对应的 `struct page *`。

```cpp
/* memmap is virtually contiguous.  */
#define __pfn_to_page(pfn)	(vmemmap + (pfn))
#define __page_to_pfn(page)	(unsigned long)((page) - vmemmap)

#define page_to_pfn __page_to_pfn
#define pfn_to_page __pfn_to_page
```

1. vmemmap 是什么？

   vmemmap 是一个虚拟地址。是 `[ffffea0000000000, ffffeaffffffffff]` 这一段 virtual memory map (简称 vmemmap) 区域的起始位置。

2. 为什么 vmemmap + pfn 就能得到对应的 `struct page *` ？

   vmemmap 区域内的一部分虚拟地址映射到了实际的物理页帧，这些物理页帧存放着 `struct page`。

   因此 vmemmap 区域可以看作是一个大小 1TB 的 `struct page` 数组，可以容纳 `1TB / sizeof(struct page)` 个 `struct page`，可以描述 `1TB / 64B * 4KB =  64TB` 的物理内存。

3. `struct page` 实际存储在哪？亦即：vmemmap 映射到哪块物理内存了？

   可以说，初始化 mem_section 的过程，就是为 `struct page` 数组分配内存的过程。下文会讲。

## mem_section + vmemmap

```cpp
// mm/sparse.c
#ifdef CONFIG_SPARSEMEM_EXTREME
/* 本文讨论这种情况 */
struct mem_section **mem_section;
#else
struct mem_section mem_section[NR_SECTION_ROOTS][SECTIONS_PER_ROOT]
  ____cacheline_internodealigned_in_smp;
#endif
EXPORT_SYMBOL(mem_section);
```

`mem_section` 是一个指针数组，包含 `NR_SECTION_ROOTS` 个指针。每个指针要么为 NULL（当物理内存稀疏时，可节省内存），要么指向一个 4KB 页面，每个页面里都是 `struct mem_section` 数组。

每个 `struct mem_section` 都代表了 128MB 内存，这也是 x86 内存热插拔的最小粒度。
是怎么代表 128MB 内存的呢？实际上，内核为每个 `struct mem_section` 分配了一个 2MB 的大页面，该页面由 `struct page` 数组组成，描述了 `2MB / 64B * 4KB = 128MB` 的内存，vmemmap 区域的某个虚拟地址会映射到该物理页面。

```cpp
// include/linux/mmzone.h
struct mem_section {
  /* 在不同的阶段，有不同的作用。
   - 在早期启动阶段，
     (see sparse.c::memory_present())
   - 完成启动后。可以通过 sparse_decode_mem_map() 转为一个 struct page *
     代表 128MB 的第一个页面
     (see sparse.c::sparse_init_one_section()) */
  unsigned long section_mem_map;

  struct mem_section_usage *usage;
#ifdef CONFIG_PAGE_EXTENSION
  struct page_ext *page_ext;
  unsigned long pad;
#endif
};
```

在初始化 mem_section、为 struct page 分配内存的过程中，会顺便建立好 vmemmap 区域的映射。

```cpp
sparse_init()
  /* 1. 先为 mem_section 分配好内存 */
  memblocks_present();
    /* 分配 struct mem_section 指针数组 */
    mem_section = memblock_alloc(sizeof(struct mem_section *) * NR_SECTION_ROOTS, align);
    /* 遍历实际存在的、不是空洞的内存区域 */
    for_each_mem_pfn_range
      memory_present()
        /* 分配 struct mem_section 数组 */
        sparse_index_init(section_nr, nid);
  /* 2. 初始化这些 mem_section */
  for_each_present_section_nr
    sparse_init_nid()
      /* 分配 2MB 的物理页面，用于存放 struct page，并做好 vmemmap+pfn 到该物理内存的映射
         返回的 map 就是第一个 struct page 的虚拟地址 */
      struct page *map = __populate_section_memmap();
        /* vmemmap 区域内，struct page 的虚拟地址范围 */
        unsigned long start = (unsigned long) pfn_to_page(pfn);
        unsigned long end = start + nr_pages * sizeof(struct page);
        /* 分配 2MB 物理内存，并让 [start, end] 虚拟地址映射过去 */
        vmemmap_populate(start, end, nid, altmap);->vmemmap_populate_hugepages()
          /* 用的是 2MB 大页 */
          vmemmap_alloc_block_buf(PMD_SIZE, node, altmap);
          vmemmap_set_pmd()
      /* 完成对一个 mem_section 的初始化 */
      sparse_init_one_section(__nr_to_section(pnum), pnum, map, usage, SECTION_IS_EARLY);
```

`vmemmap_alloc_block_buf()` 会尝试从 `sparsemap_buf` 分配连续的 2MB 内存，`sparsemap_buf` 就是为了 vmemmap 而存在的，不细讲了，详见 `sparse_buffer_alloc()`。

## 传统的 sparse mem

在开启了 `CONFIG_SPARSEMEM` 但未开启 `CONFIG_SPARSEMEM_VMEMMAP` 时，也就是传统的 sparse mem 情况下，mem_section 有另一个作用。
对于传统的 sparse mem，`page_to_pfn` 不是借助 vmemmap 完成的，而是借助于 mem_section（效率更低）。造成这种差异的原因是，这两种情况下 `__populate_section_memmap` 函数的实现是不同的，传统的 sparse mem 并未建立起 vmemmap 的映射。

## mem_section 的其他作用

见 [memory hotplug](./hotplug.md)

## 总结

mem_section 最初的作用是支持 `pfn_to_page()`，后面出现 `CONFIG_SPARSEMEM_VMEMMAP` 这一方案后，在初始化 mem_section、为 struct page 分配内存时，会顺便建立起 vmemmap 区域的映射，此后 `pfn_to_page()` 不需要 mem_section 的参与。（虽然也可以通过 `sparse_decode_mem_map()` 得到 struct page，但没 vmemmap 高效。）

## 或许可以水个 patch

`__section_mem_map_addr` 在未启用 `CONFIG_SPARSEMEM_VMEMMAP` 时用不到。

```cpp
#if defined(CONFIG_SPARSEMEM) && !defined(CONFIG_SPARSEMEM_VMEMMAP)  // [!code ++]
static inline struct page *__section_mem_map_addr(struct mem_section *section)
{
	unsigned long map = section->section_mem_map;
	map &= SECTION_MAP_MASK;
	return (struct page *)map;
}
#endif  // [!code ++]
```