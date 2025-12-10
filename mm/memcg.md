# Memory Control Group

- [\[译\] Control Group v2（cgroupv2 权威指南）（KernelDoc, 2021）](https://arthurchiao.art/blog/cgroupv2-zh/)
- 《Linux 内核深度解析》3.18 内存资源控制器

先了解 [cgroup](../other/cgroup.md)

```bash
mount -t cgroup2 none /sys/fs/cgroup
```

- 使用方法（呈现给用户空间的接口）
  - `static struct cftype memory_files[]`
  - `static struct cftype swap_files[]`
  - `static struct cftype zswap_files[]`
- v1 和 v2 区别
- 供其他模块使用的接口

memcontrol.c 功能划分

- 启动选项
  - cgroup.memory= 用于禁止不记录哪些内存，比如 socket, bpf 等等
- mem_cgroup_calculate_protection()
- 获取 mem_cgroup
  - active_memcg() 获取当前 task 的 active_memcg，或者在中断上下文获取 per-cpu 的
    - [ ] 什么是 active_memcg？和 mem_cgroup_from_task() 从 task_struct.cgroups 里的获取的有何不同？
    - [ ] 什么是中断上下文的 active_memcg？
  - 其他的一些，获取与 task_struct、mm_struct、 关联的
  - mem_cgroup_iter() 遍历层级树
- lruvec 相关
- try_charge_memcg()
  - mem_cgroup_handle_over_high() 处理超过 high limit 的情况
  - mem_cgroup_oom() oom 处理
- kmem 相关
- obj_stock obj_cgroup
- slab 相关
  - `__memcg_slab_post_alloc_hook()`
- 脏页回写相关
  - memcg_wb_domain_xxx()
  - mem_cgroup_wb_stats()
  - mem_cgroup_track_foreign_dirty_slowpath()
  - mem_cgroup_flush_foreign()
- `static struct cftype memory_files[]`
  - 创建 `mem_cgroup_css_alloc()`
- mem_cgroup_calculate_protection() 检查内存开销是否在正常范围，会修改 counter->emin 和 counter->elow
- charge
- hugetlb 相关
  - mem_cgroup_charge_hugetlb()
- swap 相关
  - mem_cgroup_swapin_charge_folio()
- uncharge
- mem_cgroup_replace_folio()
- mem_cgroup_migrate() 页面迁移
- socket 相关
- swap
- zswap

---

统计的内存有：

- 用户态内存
  - 匿名页
  - 文件页
- 内核数据结构
  - Slub
  - TCP 缓冲区
  - 其他

TODO 找到上述统计对应的相应代码

## 创建

```cpp
struct mem_cgroup {
	struct cgroup_subsys_state css;
}
```

```cpp
mem_cgroup_css_alloc()
```

创建流程详见 [cgroup](../other/cgroup.md)

## memcg_stock, obj_stock

https://aistudio.google.com/u/1/prompts/1Mw95zDmuKBLFWsRuRyNdKbTPImfcw7MB

“stock”的含义为“储备”、“库存”，表示一种缓冲、缓存或预分配的资源。

使用 Per-CPU 的 memcg_stock，降低锁竞争，是一种在高并发场景下能显著提升性能的“预收费/预记账”缓存机制。
