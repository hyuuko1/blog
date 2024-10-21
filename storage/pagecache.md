# page cache

- struct address_space
  每个 inode 都有一个 address_space，管理了该文件在内存中缓存的所有 pages。
  文件的偏移量，可以看作是地址？[0, 文件大小]。整个文件可以看作是一个地址空间？
