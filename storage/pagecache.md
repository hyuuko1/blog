# page cache

- struct address_space
  每个 inode 都有一个 address_space，管理了该文件在内存中缓存的所有 pages。
  文件的偏移量，可以看作是地址？[0, 文件大小]。整个文件可以看作是一个地址空间？

```cpp
struct inode {
	/* i_mapping 和 i_data 的区别是？
	i_mapping 一定指向 i_data 吗？ */
	struct address_space	*i_mapping;
	struct address_space	i_data;
};

struct address_space {
	struct inode		*host;
	struct xarray		i_pages;
	...
};
```

`inode_init_always_gfp()` 时，i_mapping = &i_data

在 `dax_open()` 里不是这样。

## pgoff_t

```cpp
struct folio {
	/* 与匿名页不同，对于文件页而言，这个 index 是以 4KB 为单位的 */
	pgoff_t index;
};
/* 相关函数 */
filemap_fault()
  folio = __filemap_get_folio(mapping, index, FGP_CREAT|FGP_FOR_MMAP, vmf->gfp_mask);
    filemap_add_folio(mapping, folio, index, gfp);
      /* 把 folio 放进 pagecache */
      __filemap_add_folio(mapping, folio, index, gfp, &shadow);
        folio->index = xas.xa_index;
```

## pagecache

```cpp
/* 将 folio 加入进 page cache */
int __filemap_add_folio(struct address_space *mapping, struct folio *folio, pgoff_t index, gfp_t gfp, void **shadowp)
  XA_STATE_ORDER(xas, &mapping->i_pages, index, folio_order(folio));
  folio->mapping = mapping;
  folio->index = xas.xa_index;
  xas_lock_irq(&xas);
  xas_store(&xas, folio);

/* 从 page cache 移除 folio
   XXX 这样的函数为什么这么多？ */
void page_cache_delete(struct address_space *mapping, struct folio *folio, void *shadow)
void page_cache_delete_batch(struct address_space *mapping, struct folio_batch *fbatch)
void delete_from_page_cache_batch(struct address_space *mapping, struct folio_batch *fbatch)
void filemap_remove_folio(struct folio *folio)

/* 从 page cache 中获取 folio */
struct folio *filemap_get_folio(struct address_space *mapping, pgoff_t index)
  folio = filemap_get_entry(mapping, index);
    /* 根据 index 从 mapping->i_pages 这个 xarray 中获取 */
    XA_STATE(xas, &mapping->i_pages, index);
    rcu_read_lock();
    folio = xas_load(&xas);
```

- [ ] 关于锁的使用。
  - 写用 xas_lock_irq()
  - 读用 rcu_read_lock()
  - 例子。
    - split_huge_pages_in_file() 从 mapping 里获取到 folio 后，folio_trylock() 还要检查下 if (folio->mapping != mapping)
      这是因为从找到 folio 到 try lock 这期间，folio 可能已经被释放了（因内存回收等原因）？
- [ ] folio->mapping 是 address_space 时，有哪些比较特殊的的情况？
  - shmem 虽然不是 file-backed 但是仍然有 inode、address_space 等
  - [ ] swapcache ？匿名页所处的一个特殊状态？待确认，不确定位于 swapcache 的 page 的 mapping 是否是 address_space，忘了。
