## struct vm_area_struct

```cpp
struct vm_area_struct {
	union {
		struct {
			/* VMA covers [vm_start; vm_end) addresses within mm */
			unsigned long vm_start;
			unsigned long vm_end;
		};
#ifdef CONFIG_PER_VMA_LOCK
		struct rcu_head vm_rcu;	/* Used for deferred freeing. */
#endif
	};

	struct mm_struct *vm_mm;
	pgprot_t vm_page_prot;          /* Access permissions of this VMA. */

	union {
		const vm_flags_t vm_flags;
		vm_flags_t __private __vm_flags;
	};

#ifdef CONFIG_PER_VMA_LOCK
	bool detached;
	int vm_lock_seq;
	/* Unstable RCU readers are allowed to read this. */
	struct vma_lock *vm_lock;
#endif

	struct {
		struct rb_node rb;
		unsigned long rb_subtree_last;
	} shared;

	struct list_head anon_vma_chain;
	struct anon_vma *anon_vma;
	/*  */
	const struct vm_operations_struct *vm_ops;

	/* pgoff 即 page offset，即：以页为单位的偏移量。
	   - 对于文件页。是 mmap 的最后一个参数 off>>12，也就是 VMA 起始位置在文件内的偏移，单位为4KB
	   - 对于私有匿名页。是 mmap 的第一个参数 addr 在被 __get_unmapped_area 调整后，
	      再右移12得到的值。注意，这个 addr 会被设置成 vm_start，因此实际上 vm_pgoff==vm_start>>12
	   - 对于共享匿名页。是 0，是在 do_mmap 函数里置 0 然后 mmap_region->vma_set_range 的
	 */
	unsigned long vm_pgoff;
	/* 对于私有匿名映射，是 NULL */
	struct file * vm_file;
	void * vm_private_data;
};

struct vm_operations_struct {
	/* 在创建虚拟内存区域时调用 open 方法，通常不使用，置为 NULL */
	void (*open)(struct vm_area_struct * area);
	/* 在删除虚拟内存区域时调用 close 方法，通常不使用，置为 NULL */
	void (*close)(struct vm_area_struct * area);
	int (*may_split)(struct vm_area_struct *area, unsigned long addr);
	/* 使用系统调用 mremap 移动虚拟内存区域时调用 mremap 方法 */
	int (*mremap)(struct vm_area_struct *area);
	/* 使用系统调用 mprotect 设置访问权限时调用 mprotect 方法，几乎不使用 */
	int (*mprotect)(struct vm_area_struct *vma, unsigned long start,
			unsigned long end, unsigned long newflags);
	/* 访问文件映射的虚拟页时，如果没有映射到物理页，生成缺页异常，
	   异常处理程序调用 fault 方法来把文件的数据读到文件的页缓存中 */
	vm_fault_t (*fault)(struct vm_fault *vmf);
	/* 用于透明大页的文件映射。这里的文件是指 hugetlbfs 中的文件 */
	vm_fault_t (*huge_fault)(struct vm_fault *vmf, unsigned int order);
	/* 访问文件映射的虚拟页时，如果没有映射到物理页，生成缺页异常，
	   异常处理程序除了读入正在访问的文件页，还会预读后续的文件页，
	   调用 map_pages 方法在文件的页缓存中分配物理页 */
	vm_fault_t (*map_pages)(struct vm_fault *vmf,
			pgoff_t start_pgoff, pgoff_t end_pgoff);
	unsigned long (*pagesize)(struct vm_area_struct * area);
	/* 第一次写私有的文件映射时，生成页错误异常，异常处理程序
	   执行写时复制，调用 page_mkwrite 方法以通知文件系统页即将变成可写，
	   以便文件系统检查是否允许写，或者等待页进入合适的状态 */
	vm_fault_t (*page_mkwrite)(struct vm_fault *vmf);
	/* 和 page_mkwrite 方法类似，区别是 pfn_mkwrite 方法针对页帧号映射和混合映射 */
	vm_fault_t (*pfn_mkwrite)(struct vm_fault *vmf);
	int (*access)(struct vm_area_struct *vma, unsigned long addr,
		      void *buf, int len, int write);
	const char *(*name)(struct vm_area_struct *vma);
	int (*set_policy)(struct vm_area_struct *vma, struct mempolicy *new);
	struct mempolicy *(*get_policy)(struct vm_area_struct *vma,
					unsigned long addr, pgoff_t *ilx);
	struct page *(*find_special_page)(struct vm_area_struct *vma,
					  unsigned long addr);
};
```

- struct vm_area_struct
  `vma_link()` 会把 VMA 放进两个数据结构中。之前还会放到一个链表里，现在是不需要了？
  - vma_iter_store(&vmi, vma); 是放进 mm_struct 里的 maple tree 里。
    这个 maple tree 的用途：给定一个虚拟地址，找到对应的 VMA。
  - vma_link_file(vma); 是放进 address_space 里的一个基于 rbtree 的 interval tree 里。
    用途：文件页的反向映射？回收内存/页面迁移时，给定物理页 struct folio（可能是多个页面），遍历该文件页所属 address_space 里所有的 VMA，找到该 VMA（如何找到的：struct folio 里记录该页面在文件中的偏移，VMA 里也记录了该 VMA 在文件里的偏移），然后解映射。
    try_to_unmap->rmap_walk->rmap_walk_file

TODO 为什么要改成 maple tree。

[mmap](./mmap.md)

## `vma_address()`

注意，对于线性映射区的，可以直接用 `page_to_virt` 宏。

用于获取物理页面的虚拟地址，常被反向映射所使用。

例子：

```cpp
rmap_walk_anon()
  unsigned long address = vma_address(vma, folio->index, folio_nr_pages(folio));

static inline unsigned long vma_address(struct vm_area_struct *vma,
		pgoff_t pgoff, unsigned long nr_pages)
{
	unsigned long address;

	if (pgoff >= vma->vm_pgoff) {
		address = vma->vm_start +
			((pgoff - vma->vm_pgoff) << PAGE_SHIFT);
		/* Check for address beyond vma (or wrapped through 0?) */
		if (address < vma->vm_start || address >= vma->vm_end)
			address = -EFAULT;
	} else if (pgoff + nr_pages - 1 >= vma->vm_pgoff) {
		/* Test above avoids possibility of wrap to 0 on 32-bit */
		address = vma->vm_start;
	} else {
		address = -EFAULT;
	}
	return address;
}

虚拟地址 = vma->vm_start + ((folio->index - vma->vm_pgoff) << PAGE_SHIFT)
         = VMA起始虚拟地址 + 物理页面相对于VMA起始虚拟地址的偏移
```

##

```cpp
insert_vm_struct
```
