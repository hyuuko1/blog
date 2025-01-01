# ioremap

- 函数 `ioremap() `把外设寄存器的物理地址映射到内核虚拟地址空间。
- 函数 `io_remap_pfn_range()` 把外设寄存器的物理地址映射到进程的用户虚拟地址空间。
- 函数 `remap_pfn_range()` 用于把内存的物理页映射到进程的用户虚拟地址空间。
  除了 SPARC 处理器以外，在其他处理器架构中函数 `io_remap_pfn_range()` 和函数 `remap_pfn_range()` 等价。
- 函数 `iounmap()` 用来解除函数 `ioremap()` 创建的映射
