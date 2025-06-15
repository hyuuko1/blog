# vmap

TODO: 把 [vmalloc.md](./vmalloc.md) 中的 vmap 搬到这里。

vmap 的使用者可以分为两类。

1. `__vmap_pages_range_noflush()` 映射多个不连续的 page
   1. `__pcpu_map_pages()`
   2. `vmap_pages_range()`
      1. `__vmalloc_area_node()`
      2. `vmap()`
      3. ...
2. `vmap_page_range()`
   映射连续的页面。多为 ioremap 场景。

ioremap 传入的物理地址，不能 `__va()` 直接转为虚拟地址？？

ioremap 的必须通过 iounmap 释放。

注意，iounmap 并不会释放 pte page，

##

每个类型都表示一个页表项，
pgd
pud
pmd
pte

如果是指针类型，则要么表示指向一个页表，要么表示指向页表中的一个页表项。

## huge vmap

x86 arm64 riscv 都默认有 `CONFIG_HAVE_ARCH_HUGE_VMAP`

```cpp
vmap_range_noflush()
  pgd = pgd_offset_k(addr);
  vmap_p4d_range()
    p4d = p4d_alloc_track(&init_mm, pgd, addr, mask);
    vmap_pud_range()
      pud = pud_alloc_track(&init_mm, p4d, addr, mask);
      vmap_try_huge_pud()
      vmap_pmd_range()
        pmd = pmd_alloc_track(&init_mm, pud, addr, mask);
	vmap_try_huge_pmd()
	  pmd_free_pte_page()
	  pmd_set_huge(pmd, phys_addr, prot);
	vmap_pte_range()
          set_pte_at()

pmd_free_pte_page()
```

怀疑 pmd_free_pte_page() 可能有 bug。
可能这个 pmd range 的 2MB 之前就是 huge 映射的，
不存在 pte page，
需要新增逻辑：如果 `_PAGE_PSE`，则不 free_page。
