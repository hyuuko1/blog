```cpp
/* 把外设寄存器的物理地址映射到内核虚拟地址空间。
   外设寄存器的物理地址并不能直接 phys_to_virt() 转换为虚拟地址。
   必须 ioumap() 释放。

   实现原理也很好猜。
   首先，没指定虚拟地址，那么肯定要分配内核虚拟地址，那肯定就和 vmalloc 用的是同一套分配逻辑，
   分配好后，就要映射，也就是 vmap。
*/
void __iomem *ioremap(resource_size_t phys_addr, unsigned long size)


/* 把内存的物理页映射到进程的虚拟地址空间。用处：实现进程和内核共享内存。
   例子：/dev/mem
   一看这个函数带 vma 参数，就知道和 vma->mm 这个进程地址空间有关了。
*/
int remap_pfn_range(struct vm_area_struct *vma, unsigned long addr,
		    unsigned long pfn, unsigned long size, pgprot_t prot)
/* 把外设寄存器的物理地址映射到进程的用户虚拟地址空间 */
static inline int io_remap_pfn_range(struct vm_area_struct *vma,
				     unsigned long addr, unsigned long pfn,
				     unsigned long size, pgprot_t prot)
{
	return remap_pfn_range(vma, addr, pfn, size, pgprot_decrypted(prot));
}

int vm_insert_page(struct vm_area_struct *vma, unsigned long addr,
			struct page *page)

/* page fault 时调用这个 */
vm_fault_t vmf_insert_pfn(struct vm_area_struct *vma, unsigned long addr,
			unsigned long pfn);
```

还有很多 API

- [ ] 哪些物理地址可以 phys_to_virt() ？为什么外设寄存器的物理地址不可？
- [ ] 为什么 remap_pfn_range() 的实现里不尝试进行 huge map ?
      DeepSeek 的回答是：
      remap_pfn_range 的设计目标是处理通用物理内存映射，而非特定的大页场景。被映射的物理地址可能未对齐或长度不足大页的整数倍（例如非 2M 对齐或长度小于 2M）。此时，使用 4K 小页能更灵活地适配任意地址和大小。

      梳理一下目前支持的 huge map：

  - 内核态
    - vmap 会尝试
    - vmemmap https://docs.kernel.org/mm/vmemmap_dedup.html
  - 用户态
    - hugetlbfs 通过 mmap，在 page fault 时进行 map。
    - transparent huge page 会尝试

- [ ] mremap 系统调用
- [ ] 如果在 ioremap 后不进行 iounmap 被认为是 bug，那么是否但执行到 vmap_try_huge_pmd()->pmd_free_pte_page() 时，就意味着出现了未 iounmap 的 bug？是否应该打印 warning ？

例子：

- /dev/mem
