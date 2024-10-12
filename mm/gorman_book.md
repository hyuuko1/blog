# Understanding the Linux Virtual Memory Manager

- https://pdos.csail.mit.edu/~sbw/links/gorman_book.pdf
- https://www.kernel.org/doc/gorman/

这本书是按 2.6 版本写的，但仍不过时

## 书籍目录

1. introduction
2. describing physical memory
3. page table management
4. process address space
5. boot memory allocator
6. physical page allocation
7. noncontiguous memory allocation
8. slab allocator
9. high memory management
10. page frame reclamation
11. swap management
12. shared memory virtual filesystem
13. out of memory management

## 内存管理学习顺序

For when the code has to be approached afresh with a later VM, it is always best to start in an isolated region that has the minimum number of dependencies.

1. In the case of the VM, the best starting point is the Out Of Memory (OOM) manager in mm/oom kill.c. It is a very gentle introduction to one corner of the VM where a process is selected to be killed in the event that memory in the system is low. Because this function touches so many diﬀerent aspects of the VM, it is covered last in this book.
2. The second subsystem to then examine is the noncontiguous memory allocator located in mm/vmalloc.c and discussed in Chapter 7 because it is reasonably contained within one ﬁle.
3. The third system should be the physical page allocator located in mm/page alloc.c and discussed in Chapter 6 for similar reasons.
4. The fourth system of interest is the creation of Virtual Memory Addresses (VMAs) and memory areas for processes discussed in Chapter 4.

Between these systems, they have the bulk of the code patterns that are prevalent throughout the rest of the kernel code, which makes the deciphering of more complex systems such as the page replacement policy or the buﬀer Input/Output (I/O) much easier to comprehend.
