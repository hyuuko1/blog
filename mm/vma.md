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
  const struct vm_operations_struct *vm_ops;

  /*  - 对于文件页。是 mmap 的最后一个参数 off>>12，也就是 VMA 起始位置在文件内的偏移，单位为4KB
      - 对于匿名页私有页。是 mmap 的第一个参数 addr 在被 __get_unmapped_area 调整后，
         再右移12得到的值。注意，这个 addr 会被设置成 vm_start，因此实际上 vm_pgoff==vm_start>>12
      - 对于匿名页共享页。是 0，是在 do_mmap 函数里置 0 然后 mmap_region->vma_set_range 的
   */
  unsigned long vm_pgoff;
  struct file * vm_file;
  void * vm_private_data;
}
```

- struct vm_area_struct
  `vma_link()` 会把 VMA 放进两个数据结构中。
  - vma_iter_store(&vmi, vma); 是放进 mm_struct 里的 maple tree 里。
    这个 maple tree 的用途：给定一个虚拟地址，找到对应的 VMA。
  - vma_link_file(vma); 是放进 address_space 里的一个基于 rbtree 的 interval tree 里。
    用途：文件页的反向映射？回收内存/页面迁移时，给定物理页 struct folio（可能是多个页面），遍历该文件页所属 address_space 里所有的 VMA，找到该 VMA（如何找到的：struct folio 里记录该页面在文件中的偏移，VMA 里也记录了该 VMA 在文件里的偏移），然后解映射。
    try_to_unmap->rmap_walk->rmap_walk_file

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
