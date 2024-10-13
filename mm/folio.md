# folio

## 参考

- [Linux Large Folios 大页在社区和产品的现状和未来-CSDN 博客](https://blog.csdn.net/feelabclihu/article/details/137983188)

##

- mapping 字段
  - 如果是文件页。指向一个 `struct address_space`，表明所属的文件
  - 如果是匿名页。指向一个 `struct anon_vma`
- index 字段
  - 如果是文件页。这个就是文件内的偏移量，单位为 4KB。
  - 如果是匿名共享页。这个就是相对于 vma->vm_start 的偏移量
  - 如果是匿名私有页。这个就是虚拟页面号

```cpp
folio_mapping
```
