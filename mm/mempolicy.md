# Memory Policy 内存策略

- [NUMA Memory Policy — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/mm/numa_memory_policy.html)
- [NUMA policy and memory types \[LWN.net\]](https://lwn.net/Articles/862707/)
- [set_mempolicy(2) - Linux manual page](https://man7.org/linux/man-pages/man2/set_mempolicy.2.html)
- [get_mempolicy(2) - Linux manual page](https://man7.org/linux/man-pages/man2/get_mempolicy.2.html)
- [mbind(2) - Linux manual page](https://man7.org/linux/man-pages/man2/mbind.2.html)

Memory Policy 决定了在 NUMA 系统中，内核会在哪个 Node 分配内存。
Linux 在 2.4 开始支持 Non-Uniform Memory Access architectures，在 2004-05-22 的 [2.6.7](https://kernelnewbies.org/Linux_2_6_7) 版本[引入 memory policy 支持](https://git.kernel.org/pub/scm/linux/kernel/git/history/history.git/commit/?id=d3b8924aa8ba6adc312644e19b49dbbdd2238599)。

Memory Policy 不应与 cpusets 混淆，后者是一种管理机制，用于限制一组进程可以从哪些节点分配内存。内存策略是应用程序可以利用的编程接口。同时将 cpusets 和 Memory Policy 于任务时，cpuset 的限制将优先。
