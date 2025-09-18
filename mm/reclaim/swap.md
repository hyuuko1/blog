# swap

- [Linux Swap Table Code Shows The Potential For Huge Performance Gains - Phoronix](https://www.phoronix.com/news/Linux-Swap-Table-Patches)
  评论区讨论了挺多的。

## 参考

- [从 swap_cache 角度看 swap 子系统 - 知乎](https://zhuanlan.zhihu.com/p/688743499)
- [linux 内存源码分析 - 内存回收(整体流程) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5435068.html)
- [linux 内存源码分析 - 内存回收(lru 链表) - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5447448.html)
- [linux 内存源码分析 - 直接内存回收中的等待队列 - tolimit - 博客园](https://www.cnblogs.com/tolimit/p/5481419.html)
- [Linux Swap 与 Zram 详解 - 泰晓科技](https://tinylab.org/linux-swap-and-zram/)
- [\[内核内存\] \[arm64\] 内存回收 3---kswapd 内核线程回收\_kwsapd-CSDN 博客](https://blog.csdn.net/u010923083/article/details/116278405)
- [\[内核内存\] \[arm64\] 内存回收 4---shrink_node 函数详解\_shrink node-CSDN 博客](https://blog.csdn.net/u010923083/article/details/116278456)

## swap cache

一个 swap file 在内核中被视为一个特殊的文件，它有自己的 inode，并且这个 inode 关联一个 address_space 对象，全局变量 swapper_spaces 数组管理着这些对象。

内核可以重用为文件页缓存（File Page Cache）设计的所有基础架构来管理交换缓存（Swap Cache），包括：

- 使用 XArray (address_space 的 i_pages) 来索引 swap slot。
- 使用 address_space_operations 来定义读写操作。
- 重用页面锁定、脏页跟踪等通用逻辑。

## 为什么要有 Swap Cache？

- 共享（Sharing）: 这是最主要的原因。考虑一个父进程 fork() 出一个子进程，它们共享写时复制（Copy-on-Write）的匿名页面。如果这个共享页面被 swap out，它在 swap file 中只占用一个 slot。当父子进程都尝试访问这个页面时，它们必须 fault 到同一个物理页面上。Swap Cache 提供了一个统一的、由 (swap_file, offset) 索引的命名空间，确保无论哪个进程先触发 swap in，它们最终都会映射到同一个被读回内存的 folio。如果没有 swap cache，每个进程可能会尝试读入自己的私有副本，这会破坏共享并浪费内存和 I/O。
- 效率和避免竞争: Swap Cache 可以作为一个锁和同步点。当一个进程触发 swap in 时，它会分配一个 folio，将其放入 swap cache，并锁住它（PG_locked），然后发起 I/O。

## 如何处理并发 Swap In？

这正是通过上面提到的锁定机制来处理的。

1. 进程 A 访问一个 swapped-out 页面，在 swap cache 中找不到对应的 folio。
2. 进程 A 分配一个新的 folio，把它插入到 swap cache 中，并设置 PG_locked 锁定位，然后向磁盘发出读请求。
3. 在 I/O 进行中，进程 B 也访问同一个页面。它会在 swap cache 中找到进程 A 放入的 folio。
4. 进程 B 检查到 PG_locked 位被设置，它就知道已经有别人在为这个页面努力了。它不会再发起一次 I/O，而是简单地在 folio 的等待队列上睡眠（folio_wait_locked()）。
5. 当 I/O 完成后，进程 A 的中断处理程序会清除 PG_locked 位，并唤醒所有等待在这个 folio 上的进程（包括进程 B）。
6. 此时，进程 A 和 B 都看到了一个数据有效且已经解锁的 folio，它们各自完成页表映射，然后继续执行。

这个机制优雅地解决了并发问题，将多次 swap in 请求合并为一次物理 I/O，极大地提高了效率。
