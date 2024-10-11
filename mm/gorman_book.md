# Understanding the Linux Virtual Memory Manager

- https://pdos.csail.mit.edu/~sbw/links/gorman_book.pdf
- https://www.kernel.org/doc/gorman/

## 目录

1. describing physical memory
2. page table management
3. process address space
4. boot memory allocator
5. physical page allocation
6. noncontiguous memory allocation
7. slab allocator
8. high memory management
9. page frame reclamation
10. swap management
11. shared memory virtual filesystem
12. out of memory management

For when the code has to be approached afresh with a later VM, it is always best
to start in an isolated region that has the minimum number of dependencies. In
the case of the VM, the best starting point is the Out Of Memory (OOM) manager
in mm/oom kill.c. It is a very gentle introduction to one corner of the VM where
a process is selected to be killed in the event that memory in the system is low.
Because this function touches so many diﬀerent aspects of the VM, it is covered
last in this book. The second subsystem to then examine is the noncontiguous
memory allocator located in mm/vmalloc.c and discussed in Chapter 7 because it
is reasonably contained within one ﬁle. The third system should be the physical page
allocator located in mm/page alloc.c and discussed in Chapter 6 for similar reasons.
The fourth system of interest is the creation of Virtual Memory Addresses (VMAs)
and memory areas for processes discussed in Chapter 4. Between these systems,
they have the bulk of the code patterns that are prevalent throughout the rest of the
kernel code, which makes the deciphering of more complex systems such as the page
replacement policy or the buﬀer Input/Output (I/O) much easier to comprehend.

## `pglist_data`

每个 node 都用 `pg_data_t` 描述。

```cpp
// linclude/linux/mmzone.h

typedef struct pglist_data {
  /* 本 node 内的 zone */
  struct zone node_zones[MAX_NR_ZONES];
  /* 所有 node 的 zone */
  struct zonelist node_zonelists[MAX_ZONELISTS];

  ...
} pg_data_t;

// mm/numa.c
struct pglist_data *node_data[MAX_NUMNODES];
```
