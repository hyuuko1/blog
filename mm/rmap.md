# rmap 反向映射

- struct folio
- struct mm_struct
- struct address_space
  每个 inode 都有一个 address_space，管理了该文件在内存中缓存的所有 pages。
  文件的偏移量，可以看作是地址？[0, 文件大小]。整个文件可以看作是一个地址空间？
- struct vm_area_struct
  `vma_link()` 会把 VMA 放进两个数据结构中。
  - vma_iter_store(&vmi, vma); 是放进 mm_struct 里的 maple tree 里。
    这个 maple tree 的用途：给定一个虚拟地址，找到对应的 VMA。
  - vma_link_file(vma); 是放进 address_space 里的一个基于 rbtree 的 interval tree 里。
    用途：文件页的反向映射？回收内存/页面迁移时，给定物理页 struct folio（可能是多个页面），遍历该文件页所属 address_space 里所有的 VMA，找到该 VMA（如何找到的：struct folio 里记录该页面在文件中的偏移，VMA 里也记录了该 VMA 在文件里的偏移），然后解映射。
    try_to_unmap->rmap_walk->rmap_walk_file
  - 那匿名页的反向映射呢？是哪个数据结构？
    try_to_unmap->rmap_walk->rmap_walk_anon
    遍历 AV 里所有的 AVC（每个 AVC 指向了一个 VMA），找到这些 VMA。
    https://zhuanlan.zhihu.com/p/564867734

https://www.cnblogs.com/LoyenWang/p/12164683.html

folio 的 mapping 字段实际上是指向一个 AV。
AV 里有红黑树。
VMA 里有链表。（为什么这里面有链表？干嘛的？）anon_vma_chain_link 函数在链表里增加。
AVC 是红黑树节点，也是链表节点。

fork 时，此时还未 CoW，没有产生新的 AV，但是产生了新的 AVC（子进程的，仍然在 AV 里的红黑树里，在子进程自己的 VMA 里的链表里），产生新的 VMA（子进程的）。
发生 CoW 后，产生了新的 AV，新的物理页会指向这个 AV。
