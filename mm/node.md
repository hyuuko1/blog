# TODO node

- [Physical Memory — The Linux Kernel documentation](https://docs.kernel.org/mm/physical_memory.html)

## `struct pglist_data`

`struct pglist_data` 描述了一个内存节点。都记录在了 node_data 数组内。

```cpp
// mm/numa.c
struct pglist_data *node_data[MAX_NUMNODES];

// include/linux/numa.h
/* 给定 node id，获取 struct pglist_data */
#define NODE_DATA(nid)	(node_data[nid])
```

初始化：

```cpp
start_kernel->setup_arch
  initmem_init->x86_numa_init
    numa_init()
      numa_memblks_init()
      numa_register_nodes()
        for_each_node_mask(nid, node_possible_map)
          alloc_node_data(nid)
            /* 分配 struct pglist_data 记录在 node_dadta 数组中 */
            nd_pa = memblock_phys_alloc_try_nid(nd_size, SMP_CACHE_BYTES, nid);
            nd = __va(nd_pa);
            node_data[nid] = nd;
```

```bash
$ numactl -H
available: 2 nodes (0-1)
node 0 cpus: 0 1
node 0 size: 3915 MB
node 0 free: 3834 MB
node 1 cpus: 2 3
node 1 size: 4028 MB
node 1 free: 4004 MB
node distances:
node   0   1
  0:  10  20
  1:  20  10
```
