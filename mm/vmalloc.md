# vmalloc: 不连续物理内存分配与 vmap

## 参考

- [【原创】（十二）Linux 内存管理之 vmap 与 vmalloc - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/11965787.html)
- [Linux 内存管理 (6)vmalloc - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/8251333.html)

## 概览

vmalloc 的核心是在 vmalloc 区域中找到合适的 hole，hole 是虚拟地址连续的；然后逐页分配内存来从物理上填充 hole。

vmalloc 的 gfp_maks 和逐页分配就决定了它的属性：

- 可能睡眠，不能从中断上下文中调用，或其他不允许阻塞情况下调用。
- 虚拟地址连续、物理地址不连续、size 对齐到页。所以不适合小内存分配，开销较大。

分配得到虚拟地址，在[虚拟地址空间布局](./layout.md)中的“vmalloc/ioremap space”区域，`[ffffc90000000000, ffffe8ffffffffff]` 32 TB。

主要步骤：

1. 分配一个连续虚拟地址空间
2. 从 Buddy System 多次分配 order 为 0 的页面，这些页面不连续。
3. 通过 vmap 机制，连续的虚拟地址映射到不连续的物理页面。

## 主要数据结构

- `struct vm_struct` 管理虚拟地址和物理页之间的映射关系
- `struct vmap_area` 用于描述一段虚拟地址的区域
  - 被挂在红黑树 `static struct rb_root free_vmap_area_root` 上面。
- `struct vmap_node`

## 代码分析

核心函数 `__vmalloc_node_range_noprof()`

noprof 是指 no protection flags。protection flags 是指 `PAGE_KERNEL` 这种，

`vmalloc()` 默认使用 `GFP_KERNEL` 如果想指定 gfp_mask，应使用 `__vmalloc()`

```cpp
__vmalloc_node_range_noprof
  struct vm_struct *area = __get_vm_area_node()
    BUG_ON(in_interrupt()); /* 不能在中断上下文使用 */
    struct vm_struct *area = kzalloc_node()
    struct vmap_area *va = alloc_vmap_area(..., area)
      struct vmap_node *vn = addr_to_node(va->va_start);
  /* 分配页面并 vmap */
  __vmalloc_area_node()
    vm_area_alloc_pages()->alloc_pages_bulk_array_mempolicy_noprof()
      alloc_pages_bulk_noprof()
    vmap_pages_range()
```

`alloc_pages_bulk_noprof()` 不是本文重点，详见 [buddy system](./buddy.md)。
本文重点是 vmap。

## 用例

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
