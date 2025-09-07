---
description: rmap 反向映射原理，代码分析
head:
  - - meta
    - name: keywords
      content: rmap, 反向映射, linux, kernel, 原理, 代码分析
---

# rmap 反向映射

## 参考

- 🌟[逆向映射的演进](http://www.wowotech.net/memory_management/reverse_mapping.html)
  **整个演进历程讲的很好，必看**
- 🌟[linux 内存源码分析 - 内存回收(匿名页反向映射) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5398552.html)
  几乎每行都有注释
- 🌟[\[内核内存\] 反向映射详解](https://blog.csdn.net/u010923083/article/details/116456497)
- [【原创】（十五）Linux 内存管理之 RMAP - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/12164683.html)
- [Linux 内存管理 (12)反向映射 RMAP - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/8335483.html)
- [内存管理特性分析（三）：linux 内核反向映射(RMAP)技术分析 - 知乎](https://zhuanlan.zhihu.com/p/564867734)
- [linux 内存管理笔记(三十八）----反向映射-CSDN 博客](https://blog.csdn.net/u012489236/article/details/114734823)

## 概览

1. 反向映射是什么？

   反向映射是从物理页面到虚拟地址空间 VMA。即，给定一个 `struct page`，得到所有映射了该物理页面的 `struct vm_area_struct`，进而得到所有虚拟地址，然后 wakt page table 得到 pte。

   不同虚拟页面同时映射到同一物理页面是因为子进程克隆父进程 VMA，和 KSM 机制的存在。

2. 为什么需要反向映射？

   典型应用场景：

   - kswapd 进行页面回收时，需要断开所有映射了该匿名页面的 PTE 表项；
   - 页面迁移时，需要断开所有映射了该匿名页面的 PTE 表项；

入口函数 `rmap_walk()` 或 `rmap_walk_locked()`

```cpp
void rmap_walk(struct folio *folio, struct rmap_walk_control *rwc)
{
  if (unlikely(folio_test_ksm(folio)))
    rmap_walk_ksm(folio, rwc);
  else if (folio_test_anon(folio))
    rmap_walk_anon(folio, rwc, false);
  else
    rmap_walk_file(folio, rwc, false);
}
```

用法

```cpp
struct rmap_walk_control rwc = {
  .arg = ?,
  .rmap_one = 钩子,
  ...
};

rmap_walk(folio, &rwc);
```

## 前置知识

`struct folio` 的 `mapping` 和 `index` 字段在不同场景含义不同，详见 [folio](./folio.md)

`struct vm_area_struct` 的 `pgoff` 字段在不同场景含义不同，详见 [vma](./vma.md)

## 🚧 KSM 页的反向映射

## 文件页的反向映射

每个文件都拥有一个区间树（建立在红黑树之上的一种扩展数据结构），名为 i_mmap，许多 VMA 挂在上面，排序依据是 VMA 起始位置在文件内的偏移（单位 4KB）。

```cpp
struct address_space {
  /* 基于 rbtree 的 interval tree */
  struct rb_root_cached	i_mmap;
  ...
}
```

何时添加进 interval tree 的？

```cpp
do_mmap()->mmap_region()->vma_link_file()
  if (file)
    mapping = file->f_mapping;
    i_mmap_lock_write(mapping);
    __vma_link_file(vma, mapping);
      /* 添加进 interval tree */
      vma_interval_tree_insert(vma, &mapping->i_mmap);
    i_mmap_unlock_write(mapping);
```

反向映射

```cpp
rmap_walk_file()
  /* 对于文件页，这个就是文件内的偏移量，单位为 4KB */
  pgoff_start = folio->index;
  pgoff_end = pgoff_start + folio_nr_pages(folio) - 1
  /* 遍历 interval tree 内 [vma->vm_pgoff, vma->vm_pgoff+页面数] 与 [pgoff_start, pgoff_end] 相交的 VMA，
     对于文件页，vma->vm_pgoff 其实就是 VMA 起始位置在文件内的偏移，单位为4KB */
  vma_interval_tree_foreach(vma, &mapping->i_mmap, pgoff_start, pgoff_end)
    unsigned long address = vma_address(vma, pgoff_start, folio_nr_pages(folio));
    if (rwc->invalid_vma && rwc->invalid_vma(vma, rwc->arg))
      continue;
    if (!rwc->rmap_one(folio, vma, address, rwc->arg))
      goto done;
    if (rwc->done && rwc->done(folio))
      goto done;
```

## 匿名页的反向映射

这块还挺难理解的为什么这样设计的。我们以对用户进程的私有匿名页为例。

先解释一下各个名词，方便查阅。

- page: `struct page` 代表物理页面
  - 作为匿名页时，指向一个 AV。
  - 多个匿名页可以共用一个 AV。**这么做的目的是为了节省内存**，设计成了这样子：被同一个 VMA 映射的 page 可以共用同一个 AV，当然有个例外是，如果该 page 是父进程 fork 之后还未 Cow 的，那该 page 用的是父进程的 AV。
  - page 指向的 AV 是一个区间树，通过遍历可以得到许多 VMA，这些 VMA 的虚拟页面**有可能**映射了该 page。
- VMA: `struct vm_area_struct`
  - 是一段虚拟地址区域，包含多个虚拟页面，这些虚拟页面可能还未映射到真正的物理页面，要 page fault 之后才会。
  - 对于私有匿名映射，在 fork 后，子进程的 VMA 里的虚拟页面与父进程映射到了同一个页面。发生 CoW 后，才会映射到不同的物理页面。
- AV: `struct anon_vma` 是一个区间树
  - 当 VMA 范围内的虚拟页面有映射到实际的物理页面时，就会为 VMA 创建一个 AV。我觉得，可以认为是 VMA “拥有” AV
  - VMA 会挂到 AV 区间树上。
  - 与 VMA 的数量比是 1:1。但是，一个 VMA 可以同时挂在不同的 AV 区间树上。
- AVC: `struct anon_vma_chain`
  - 前面提到 VMA 可以挂到 AV 区间树上，但是我们会发现 VMA 里只有一个 `struct rb_node`（被用于挂在到 address_space 的 i_mmap 上，不是用于匿名页用途的？），难道，并没有用于挂到 AV 区间树上的 `struct rb_node`？
    那么，VMA 是如何挂到 AV 区间树的呢？
    答案就是通过 AVC 链表！！每个 VMA 都有一个 AVC 链表 `anon_vma_chain`（函数 `anon_vma_chain_link()` 往链表里添加新的 AVC）
    每个 AVC 里有一个 `struct rb_node`，挂到 AV 区间树上。AVC 指向它所属的 VMA。因此在逻辑上可以认为是 VMA 挂在 AV 区间树上。
    我觉得，可以这样认为，VMA 拥有多个 AVC，通过 N 个 AVC，挂到 N 个不同的 AV 区间树上。
  - 为什么不直接在 VMA 里新增一个 `struct rb_node` 用于挂到 AV 区间树上呢？
    答：这样只能支持 VMA 挂到单个 AV 区间树。为了支持挂到多个 AV 区间树上，才引入了 AVC。

为了方便理解上面的这些设计，什么 AV、AVC 啥的，让我们先自己设计一下，看看有啥缺陷。
注意：以下设计过程与真实的演进历史并不一样。

首先，明确我们的需求：给定一个 folio，得到所有的有虚拟页面映射了该 folio 的 VMA。

很容易想到，我们可以参考文件页的匿名映射。
让每个匿名页都拥有一个链表，称之为 AV。
假设有 10 个 VMA，每个 VMA 里有 20 个虚拟页面。
这 10 个 VMA 各自都有 1 个虚拟页面映射到了同一个匿名页，我们可以为这 10 个虚拟页面分配 10 个链表节点，都挂到该 AV 链表上。
这样以来，给定一个 page，我们可以遍历这个页表，得到 10 个虚拟页面地址，然后做一些 unmap 之类的操作。
有个明显的缺点：太浪费内存了，需要为每个页面映射分配内存。10 个 VMA 里共 200 个虚拟页面，如果都建立映射，就需要 200 个链表节点。

我们可以修改需求，放宽一点：给定一个 folio，得到所有的、**可能**有虚拟页面映射了该 folio 的 VMA。
然后，让被同一个 VMA 映射的匿名页共同拥一个 AV 区间树，有个例外是，如果该 page 是父进程 fork 之后还未 Cow 的，那该 page 用的是父进程的 AV。AV 区间树是 VMA 粒度的，为 VMA 创建 AV 后，会把 VMA 挂到区间树上。这样以来，给定一个 page，就可以遍历区间树得到 VMA，得到虚拟地址。

当发生 fork 时，将父进程的 VMA 复制到子进程，子进程有了 10 个 VMA，然后为这 10 个 VMA 创建 10 个 AV，10 个 VMA 分别挂到 10 个 AV 上。由于我们并未为子进程分配物理页面，所以物理页面仍然是指向父进程的 AV 的，因此我们还要把子进程的 VMA 挂到父进程的 AV 上。这样一来，给定一个 page，我们可以遍历 AV 区间树，得到父子进程的 VMA，进而得到两个虚拟地址。

page1 发生 CoW 后，为子进程分配新的物理页面 page1_c，让该页面指向子进程自己的 AV。
有个问题是，此时，对于父进程，给定 page1，遍历 AV，得到的仍然是两个 VMA，其中子进程的 VMA 已经不再映射到 page1 了而是 page1_c。
但我们也没办法把子进程的 VMA 从这个 AV 中移除，除非该 VMA 内的所有 page 都发生 CoW 了。
现在的内核代码里也没怎么做，我猜这是因为这样更复杂了，而且 VMA 内所有 page 都发生 CoW 这种情况也很少发生？

### 申请匿名页

```cpp
do_anonymous_page
  vmf_anon_prepare->__vmf_anon_prepare()
    if (likely(vma->anon_vma))
      return 0;
    __anon_vma_prepare()
      avc = anon_vma_chain_alloc(GFP_KERNEL);
      anon_vma = anon_vma_alloc();
      vma->anon_vma = anon_vma;
      anon_vma_chain_link(vma, avc, anon_vma);
        avc->vma = vma;
        avc->anon_vma = anon_vma;
        list_add(&avc->same_vma, &vma->anon_vma_chain);
        anon_vma_interval_tree_insert(avc, &anon_vma->rb_root);
```

### fork

```cpp
dup_mmap()
  vm_area_dup()
    struct vm_area_struct *new = kmem_cache_alloc(vm_area_cachep, GFP_KERNEL);
    /* 复制父进程的 VMA */
    memcpy(new, orig, sizeof(*new));
  anon_vma_fork()
    /* 不继承父进程的 AV */
    vma->anon_vma = NULL;
    /* 复制父进程的 VMA 指向的一些内容 */
    anon_vma_clone(vma, pvma)
      /* 遍历父进程的 AVC */
      list_for_each_entry_reverse(pavc, &src->anon_vma_chain, same_vma)
        avc = anon_vma_chain_alloc(GFP_NOWAIT | __GFP_NOWARN);
        /* 将新创建的 AVC 放进子进程 VMA 链表，但放进父进程 AV 区间树 */
        anon_vma = pavc->anon_vma;
        anon_vma_chain_link(dst, avc, anon_vma);
    /* 子进程自己参创建新的 AV */
    anon_vma = anon_vma_alloc();
    /* 再次创建一个 AVC */
    avc = anon_vma_chain_alloc(GFP_KERNEL);
    anon_vma->root = pvma->anon_vma->root;
    anon_vma->parent = pvma->anon_vma;
    vma->anon_vma = anon_vma;
    /* 将第二个 AVC 放进子进程自己的 VMA 链表，和自己的 AV 区间树内 */
    anon_vma_chain_link(vma, avc, anon_vma);
```

### CoW

```cpp
handle_mm_fault->__handle_mm_fault->handle_pte_fault
  if (!pte_write(entry))
    /* wp 是 write protect 的意思？ */
    do_wp_page()->wp_page_copy()
      vmf_anon_prepare(vmf) /* 实际上已经分配了 AV，所以很快就返回了 */
      /* 分配物理页面 */
      new_folio = folio_prealloc(mm, vma, vmf->address, pfn_is_zero);
      /* 拷贝 */
      __wp_page_copy_user(&new_folio->page, vmf->page, vmf);
      /*  */
      folio_add_new_anon_rmap(new_folio, vma, vmf->address, RMAP_EXCLUSIVE);
        __folio_set_anon(folio, vma, address, exclusive);
          /* 新创建的 folio 指向子进程自己的 AV */
          WRITE_ONCE(folio->mapping, (struct address_space *) anon_vma);
```

### 反向映射

```cpp
rmap_walk_anon()
  /* 对于匿名私有页，这个就是虚拟页面号
     对于匿名共享页，这个就是相对于 vma->vm_start 的偏移量 */
  pgoff_start = folio->index;
  pgoff_end = pgoff_start + folio_nr_pages(folio) - 1
  /* 遍历 interval tree 内 [vma->vm_pgoff, vma->vm_pgoff+页面数] 与 [pgoff_start, pgoff_end] 相交的 VMA，
     对于匿名私有页，vma->vm_pgoff 其实就是 vm_start 起始地址虚拟页面号
     对于匿名共享页，vma->vm_pgoff 等于 0 */
  anon_vma_interval_tree_foreach(avc, &anon_vma->rb_root, pgoff_start, pgoff_end)
    struct vm_area_struct *vma = avc->vma;
    unsigned long address = vma_address(vma, pgoff_start, folio_nr_pages(folio));
    if (rwc->invalid_vma && rwc->invalid_vma(vma, rwc->arg))
      continue;
    if (!rwc->rmap_one(folio, vma, address, rwc->arg))
      break;
    if (rwc->done && rwc->done(folio))
      break;
```

## `rmap_one` 钩子

不管是文件页还是匿名页，遍历 i_mmap 或 anon_vma->rb_root 得到的 VMA 内不一定就真的映射了这个 folio，因为：

1. 对于文件页，页面可能还不在 page cache 里
2. 对于匿名页，子进程可能已经发生了 CoW，映射到了新分配的 page，此时子进程的发生 CoW 的页面所属的 VMA 还挂在父进程的 AV 区间树上。

因此可以看到 `rmap_one` 钩子都会调用 `page_vma_mapped_walk()` 函数，如果 VMA 并没有映射这个 folio，就会直接返回。以 `try_to_unmap_one()` 为例：

```cpp
try_to_unmap_one()
  DEFINE_FOLIO_VMA_WALK(pvmw, folio, vma, address, 0);
    .pfn = folio_pfn(_folio),
    .nr_pages = folio_nr_pages(_folio),
		.pgoff = folio_pgoff(_folio),
  /* 如果 folio 不在 vma 内，page_vma_mapped_walk 会返回 false */
  while (page_vma_mapped_walk(&pvmw)) {
    ...

  }

page_vma_mapped_walk()
  /* 如果 VMA 真的映射了这个 folio，就返回 true */
  if (check_pte(pvmw))
    return true;
```
