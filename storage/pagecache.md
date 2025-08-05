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
```

`inode_init_always_gfp()` 时，i_mapping = &i_data

在 `dax_open()` 里不是这样。
