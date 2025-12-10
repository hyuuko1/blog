# vm.zone_reclaim_mode 参数

/proc/sys/vm/zone_reclaim_mode 有何作用，影响到 linux 内核的哪些具体的代码路径？给点实操建议

省流：不建议开，建议设置为 0

触发位置：[page_alloc 快速路径](../page_alloc.md)

## GPT-5 的回答

简述

- vm.zone_reclaim_mode 用来在 NUMA 机器优先把“本地节点”的页缓存回收掉（而不是直接到远端节点去分配内存），以提高内存访问的本地性。
- 代价是：这个回收发生在“内存分配路径”里，会引入同步回收/写回/换出，导致分配延迟大幅上升，甚至引发明显尾延迟。除特定场景外，一般建议关闭。

取值与含义（位掩码）

- 0：关闭（默认推荐）
- 1：启用 zone reclaim（只回收可回收的页缓存，不做写回、不换出）
- 2：允许回收时做写回（writeout file-backed）
- 4：允许回收匿名页（可能触发 swap）
- 可组合：1|2=3，1|4=5，1|2|4=7。实际生产如需打开，通常仅用 1。

影响到的内核代码路径（关键位置）

- 快速路径：内存分配
  - alloc_pages()/kmalloc -> `__alloc_pages()` -> get_page_from_freelist()（mm/page_alloc.c）
  - 在本地节点可用页不满足水位且即将回退到远端节点前，如果 zone_reclaim_mode != 0，会调用 node_reclaim()（mm/vmscan.c）
- node_reclaim() 的行为
  - 在当前 NUMA 节点做一次受限的直接回收，优先回收本地节点 LRU 上的 unmapped file pages；根据位设置决定是否：
    - may_writepage（位 2）：触发写回脏页（page_writeback 路径）
    - may_swap（位 4）：回收匿名页，可能触发 swap
  - 使用 shrink_node()/shrink_lruvec()/shrink_page_list() 等（均在 mm/vmscan.c）扫描回收；也会触发 shrink_slab() 回收 slab。
  - 受 vm.min_unmapped_ratio 与 vm.min_slab_ratio 影响：当节点的未映射文件页/SLAB 比例不够时，node reclaim 可能直接放弃，避免无意义抖动。
- 慢路径与回退
  - 若 node_reclaim 无法满足分配需求，会继续走常规回退：尝试远端节点分配，或进入 `__alloc_pages_slowpath()`，进一步触发 direct reclaim/compaction 等（加剧延迟）。
- 相关文件/符号（便于源码追踪）
  - mm/page_alloc.c: get_page_from_freelist, `__alloc_pages_slowpath`
  - mm/vmscan.c: node_reclaim, shrink_node, shrink_lruvec, shrink_page_list, shrink_slab, global 变量 zone_reclaim_mode
  - include/linux/mmzone.h / gfp.h：水位、GFP 标志与回收决策

优缺点与适用场景

- 优点：在 NUMA 惩罚很高的场景（HPC/科学计算、内存访问强局部性、几乎无匿名页、主要是文件页缓存且 I/O 带宽充裕）可以减少远端内存访问，提升带宽与缓存命中。
- 缺点：把回收/写回/换出搬到了“分配临界路径”，会显著拉长分配延迟；数据库、低延迟在线服务、JVM、大量匿名页的业务通常受害。写回或换出会进一步恶化尾延迟。
- 一般服务器/容器平台：建议关闭（0）。

实操建议

- 配置与即时生效
  - 查看：cat /proc/sys/vm/zone_reclaim_mode
  - 临时设置：sysctl -w vm.zone_reclaim_mode=0（或 1/3/5/7）
  - 永久：/etc/sysctl.conf 或 `/etc/sysctl.d/*.conf` 中设置 vm.zone_reclaim_mode=0
- 若必须开启，建议：
  - 只开 1（仅回收不写回不换出）。极少数存储顺畅的只读/hpc 场景可试 3；不建议使用 4（换出）或 7。
  - 同时检查并适度调小 vm.swappiness（例如 1–10）以降低匿名页换出概率。
  - 配合内存/CPU 亲和：numactl、cpuset、cgroup cpuset.mems，尽量把计算与内存绑定到同一节点，减少依赖回收。
  - 关注文件页比例：保证节点上有足够 unmapped file pages 可回收，否则 node reclaim 频繁失败只会增加延迟却无收益。必要时调 vm.min_unmapped_ratio 与 vm.min_slab_ratio。
- 观测与验证
  - /proc/vmstat 关键指标：
    - numa_hit/numa_miss/numa_foreign：远端分配情况
    - pgscan_direct、pgsteal_kswapd/pgsteal_direct：直接回收强度
    - allocstall, allocstall_dma32/normal/movable：分配受阻次数
    - pgactivate/pgdeactivate、nr_vmscan_write 等：回收/写回活动
  - perf/ftrace：tracepoints:mm*vmscan*_, mm*page_alloc*_，观察是否在分配路径触发同步回收/写回。
  - 业务侧：分配/暂停/GC/IO 延迟 P99+，跨节点内存带宽与 LLC 命中率（perf stat/topdown）。
- 调优流程建议
  1. 默认 vm.zone_reclaim_mode=0，建立基线。
  2. 若观测到明显 numa_miss 且远端带宽/延迟惩罚大，且节点上 cache 很多、匿名页较少，可试 vm.zone_reclaim_mode=1。
  3. 对比 P95/P99 分配延迟、IO 写放大、swap 活动、numa_miss 下降幅度。若 tail 延迟恶化或业务抖动，立即回退。
  4. 如必须进一步收敛本地性，再谨慎试 3（允许写回），配合调低脏页阈值与写回节奏；一般仍不建议。
- 常见坑
  - 在数据库/在线服务/低延迟交易系统上开启会显著放大尾延迟。
  - 与透明大页/compaction/直接回收叠加，放大抖动。
  - 容器多租环境中开启会造成“把抖动推给邻居节点”，全局观感更差。
  - 使用 swap 的系统一旦设置 bit 4，容易在负载高峰出现换出抖动。

一句话结论

- 除非是对 NUMA 本地性极其敏感、以文件缓存为主的 HPC 或特定批处理负载，否则把 vm.zone_reclaim_mode 设为 0；如要开，只开 1，并严格监控尾延迟与回收/写回行为。

## qwen 的回答

在最新 Linux 内核（6.6+）中，`/proc/sys/vm/zone_reclaim_mode` 是一个用于 **控制 NUMA 节点本地内存回收行为** 的关键 sysctl 参数。它的核心作用是：

> ✅ **当某个 NUMA 节点内存不足时，是否/如何在本地节点触发轻量级内存回收（如回收 page cache、slab），而不是立即跨节点分配或触发全局直接回收（direct reclaim）**

---

## 🧠 一、参数作用详解

该参数是一个位掩码（bitmask），默认值通常为 **0**（即**关闭本地回收**）。非零值启用不同级别的本地回收策略：

```bash
# 查看当前值
cat /proc/sys/vm/zone_reclaim_mode

# 设置值（需 root）
echo 1 > /proc/sys/vm/zone_reclaim_mode
```

### 📌 位掩码定义（include/linux/mmzone.h）：

```c
#define RECLAIM_ZONE        (1<<0)  // 启用 zone 本地回收（基础开关）
#define RECLAIM_WRITE       (1<<1)  // 允许回写 dirty page（触发 I/O）
#define RECLAIM_SWAP        (1<<2)  // 允许 swap 匿名页（可能阻塞）
#define RECLAIM_ONCE        (1<<3)  // 仅尝试一次回收，避免死循环（6.0+）
```

### 📋 常用组合：

| 值                   | 含义                                            | 适用场景                          |
| -------------------- | ----------------------------------------------- | --------------------------------- |
| `0`                  | 禁用本地回收 → 分配失败时直接跨节点或全局回收   | **默认值，推荐通用服务器/云环境** |
| `1` (`RECLAIM_ZONE`) | 仅回收 clean page cache 和 slab，不写回/不 swap | 低延迟敏感型，避免 I/O            |
| `3` (`1\|2`)         | 回收 + 允许回写 dirty page                      | 写密集型应用，愿意用 I/O 换本地性 |
| `7` (`1\|2\|4`)      | 回收 + 回写 + swap                              | 极端内存隔离场景（如 HPC 作业）   |

---

## 🧩 二、影响的具体内核代码路径（6.6+）

### 1. ➡️ `get_page_from_freelist()` → `zone_reclaim()`

当在某个 zone 分配失败，且 `ALLOC_NO_WATERMARKS` 未设置时：

```c
// mm/page_alloc.c
if (!zone_watermark_ok(...) && node_reclaim_enabled) {
    switch (node_reclaim(zone->zone_pgdat, gfp_mask, order)) {
        case NODE_RECLAIM_SOME:
            goto try_this_zone; // 回收后重试本地分配
        case NODE_RECLAIM_FULL:
        case NODE_RECLAIM_LOCKED:
            break; // 继续 fallback
    }
}
```

### 2. ➡️ `node_reclaim()` → 根据 mode 调用不同回收器

```c
// mm/vmscan.c
int node_reclaim(struct pglist_data *pgdat, gfp_t gfp_mask, unsigned int order)
{
    if (zone_reclaim_mode & RECLAIM_WRITE)
        writeback_threshold = ...; // 允许启动回写

    if (zone_reclaim_mode & RECLAIM_SWAP)
        can_swap = true;

    // 扫描本地 node 的 inactive LRU
    nr_reclaimed = shrink_node(pgdat, &sc);

    // 如果回收了足够页 → 返回 NODE_RECLAIM_SOME
}
```

### 3. ➡️ `shrink_node()` → `shrink_lruvec()` → 回收策略

- 若 `RECLAIM_WRITE` 未设置 → 跳过 dirty page（只回收 clean page cache）
- 若 `RECLAIM_SWAP` 未设置 → 跳过匿名页（不 swap）
- 回收目标：优先 page cache → 再 slab → 最后匿名页（若允许 swap）

### 4. ➡️ 影响 `kswapd` 行为（间接）

虽然 `zone_reclaim_mode` 主要影响 direct reclaim，但若频繁触发本地回收，会减少 `kswapd` 唤醒次数，因为压力被本地消化。

---

## ⚠️ 三、副作用与风险（重要！）

| 设置                  | 风险                                                    |
| --------------------- | ------------------------------------------------------- |
| `zone_reclaim_mode=1` | 可能频繁回收 page cache → 应用缓存命中率下降 → I/O 增加 |
| `zone_reclaim_mode=3` | 触发 dirty page 回写 → I/O 延迟抖动，影响实时性         |
| `zone_reclaim_mode=7` | 触发 swap → 进程阻塞，延迟飙升，不适合低延迟服务        |
| 非 0 值 + 高频分配    | CPU 开销增加（频繁扫描 LRU），可能比跨节点分配更慢      |

> 📌 **现代内核（5.10+）社区共识：在大多数场景下，保持 `zone_reclaim_mode=0` 是最优选择**。跨 NUMA 节点访问延迟虽高（~1.5x），但远低于本地回收带来的 CPU 开销 + I/O 抖动。

---

## 🛠️ 四、实操建议（生产环境调优）

### ✅ 推荐配置（90% 场景适用）：

```bash
# 通用服务器、云主机、数据库、Web 服务
echo 0 > /proc/sys/vm/zone_reclaim_mode
```

理由：避免不必要的本地回收开销，让内核自由跨节点分配，全局内存利用率更高，延迟更稳定。

---

### ⚙️ 特定场景可尝试启用：

#### 场景 1：NUMA 严格隔离（如 HPC、裸金属数据库）

```bash
# 要求进程内存尽量不跨节点，愿意牺牲性能换隔离性
echo 1 > /proc/sys/vm/zone_reclaim_mode
# 或配合 cpuset memory_spread_page=0 使用
```

#### 场景 2：写密集型 + 本地 SSD + 内存敏感

```bash
# 允许回写 dirty page，避免跨节点
echo 3 > /proc/sys/vm/zone_reclaim_mode
# 建议同时调大 vm.dirty_ratio
echo 20 > /proc/sys/vm/dirty_ratio
```

#### 场景 3：内存超卖环境（如 OpenStack 计算节点）

```bash
# 允许 swap，避免 OOM，但需确保 swap on fast SSD/NVMe
echo 7 > /proc/sys/vm/zone_reclaim_mode
echo 10 > /proc/sys/vm/swappiness
```

---

## 📊 五、监控与诊断

启用后，通过以下方式观察效果：

```bash
# 1. 监控本地回收次数
grep "pgsteal" /proc/vmstat
# pgsteal_kswapd_* 和 pgsteal_direct_* —— 若 direct 回收激增，说明 zone_reclaim 生效

# 2. 监控 NUMA 分配统计
cat /sys/devices/system/node/node*/numastat
# numa_hit / numa_miss —— 若 miss 激增，说明跨节点多；若 hit 多但 steal 多，说明本地回收频繁

# 3. 监控延迟
perf record -e "kmem:mm_page_alloc_zone_locked" -a sleep 30
perf script | grep reclaim
```

---

## 🧭 六、与其他参数的协同

| 参数                        | 建议搭配                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `vm.swappiness`             | 若设 `zone_reclaim_mode & RECLAIM_SWAP`，建议 swappiness=10~30 |
| `vm.dirty_ratio`            | 若设 `RECLAIM_WRITE`，可适当调大 dirty_ratio 避免频繁回写      |
| `cpuset.memory_spread_page` | 若设 `zone_reclaim_mode>0`，建议关闭 spread（避免冲突）        |
| `numactl --localalloc`      | 与 `zone_reclaim_mode=1` 搭配，强制本地分配+本地回收           |

---

## ✅ 总结

> **`/proc/sys/vm/zone_reclaim_mode` 是一个 NUMA 本地内存回收策略开关。在现代 Linux 内核中，默认值 0 通常是最佳选择。仅在明确需要“内存 NUMA 本地性隔离”且能接受性能/延迟代价的场景下，才考虑启用非零值。**

🔧 **实操黄金法则：**

> 除非你明确知道自己在做什么，且有监控数据支撑，否则 ——
> **永远保持 `zone_reclaim_mode = 0`**

它影响的核心路径是：
**`get_page_from_freelist()` → `node_reclaim()` → `shrink_node()` → LRU 回收器**，通过位掩码精细控制回收哪些页（clean/dirty/匿名）。

在调优前，务必用 `numastat`、`vmstat`、`perf` 等工具建立基线，避免“优化”变“劣化”。

## Gemini 的回答

好的，我们来深入探讨 `zone_reclaim_mode` 这个内核参数。这是一个与 Linux 内存管理，特别是 NUMA (Non-Uniform Memory Access) 架构紧密相关的调优参数。

### /proc/sys/vm/zone_reclaim_mode 的核心作用

在解释其作用之前，必须先理解 **NUMA** 架构。在 NUMA 系统中，CPU 被分成多个节点 (Node)，每个节点都有自己本地的内存。CPU 访问本地内存的速度非常快，但访问其他节点（远程内存）的内存时，速度会慢很多。

`zone_reclaim_mode` 的核心作用是**决定当一个 NUMA 节点上的内存不足时，内核应该采取何种策略来为进程分配内存**。

具体来说，它控制了两种行为之间的权衡：

1.  **从远程节点分配内存 (Allocate from a remote node)**：这会带来较高的访问延迟，但可以避免回收本地内存的开销。
2.  **回收本地节点的内存 (Reclaim local node's memory)**：这会强制换出或丢弃本地节点上的一些内存页（可能是文件缓存），以腾出空间。这样做可以保证新分配的内存是本地的，访问速度快，但回收操作本身会消耗 CPU 和 I/O，并可能导致正在运行的进程因缓存失效而变慢。

---

### 参数详解

`zone_reclaim_mode` 是一个位掩码 (bitmask)，不同的位相加代表不同的功能组合。

- **`0` (默认值):**

  - **策略**: 关闭 Zone Reclaim。当本地节点内存不足时，内核会优先尝试从其他节点寻找空闲内存。只有当整个系统的所有节点内存都达到低水位线 (low watermark) 时，才会开始回收内存。
  - **优点**: 避免了因本地回收导致的性能抖动。对于需要大量缓存或跨节点共享内存的应用（如大型数据库、分布式缓存）通常是最佳选择。
  - **缺点**: 可能会导致大量跨节点内存访问，增加内存访问延迟，降低性能。

- **`1` (Reclaim):**

  - **策略**: 开启 Zone Reclaim。当一个节点内存不足时，内核会**优先在当前节点内部进行内存回收**，而不是去远程节点分配。回收的目标主要是文件页（Page Cache）。
  - **优点**: 保证了内存分配的本地性 (locality)，对于对内存访问延迟极度敏感的应用（如 HPC 高性能计算、某些延迟敏感的金融交易应用）可能有利。
  - **缺点**: 如果本地节点上缓存的是热点数据，强制回收会导致严重的性能下降（缓存命中率降低，磁盘 I/O 增加）。这是最主要的副作用。

- **`2` (Writeback):**

  - **策略**: 在进行回收时，可以将脏页 (Dirty Pages) 写回磁盘。
  - **此值通常与 `1` 结合使用**，即设置为 `3` (`1` + `2`)。

- **`4` (Swap):**

  - **策略**: 在进行回收时，可以将匿名页 (Anonymous Pages) 通过交换 (Swap) 换出到磁盘。
  - **此值通常与 `1` 结合使用**，即设置为 `5` (`1` + `4`)，或者与 `1` 和 `2` 结合使用，设置为 `7` (`1` + `2` + `4`)。

**总结一下常用的值：**

| 值    | 策略                                                |
| :---- | :-------------------------------------------------- |
| **0** | **关闭。优先从远程节点分配。 (推荐的默认值)**       |
| **1** | 开启。优先回收本地节点的 Page Cache。               |
| **3** | 开启。优先回收本地节点的 Page Cache，并可回写脏页。 |
| **5** | 开启。优先回收本地 Page Cache，并可 Swap 出匿名页。 |

---

### 影响到的 Linux 内核具体代码路径

这个参数主要影响内核的**页分配器 (Page Allocator) 的慢速路径 (Slow Path)**。当快速分配（直接从伙伴系统的 free list 中获取）失败后，内核会进入一个更复杂的流程来尝试满足内存请求。

以下是简化的代码逻辑和关键函数路径：

1.  **入口点**: 内存分配的请求通常经过 `alloc_pages()` 或类似的接口，最终会调用到核心分配函数 `__alloc_pages_nodemask()`。

2.  **快速路径失败**: 在 `get_page_from_freelist()` 中，如果无法从本地节点的空闲链表中找到足够的内存页，分配就会进入慢速路径 `__alloc_pages_slowpath()`。

3.  **慢速路径的核心决策**: 在 `__alloc_pages_slowpath()` 中，内核会遍历一个预先定义好的区域列表 (zonelist)，这个列表定义了从哪些 NUMA 节点和内存区域 (Zone) 尝试分配内存的顺序。

4.  **`zone_reclaim_mode` 的检查点**: 在遍历 zonelist，准备从下一个 Zone（可能是远程节点）分配内存之前，内核会进行一个关键检查。这个逻辑大致如下 (伪代码):

    ```c
    // in __alloc_pages_slowpath() or a function it calls

    for_each_zone_in_zonelist(zone) {
        // ...
        if (zone is below its watermark) {
            // **这里是关键**
            // 如果 zone_reclaim_mode 被设置 (非0) 并且可以进行回收
            if (zone_reclaim_mode & RECLAIM_ZONE && can_reclaim(zone, ...)) {
                // 调用 zone_reclaim() 进行本地回收
                if (zone_reclaim(zone, gfp_mask, ...) == RECLAIM_SUCCESS) {
                    // 回收成功，再次尝试从本 zone 分配
                    page = get_page_from_freelist(...);
                    if (page) return page; // 成功！
                }
            }
        }
        // ...
    }
    ```

5.  **实际的回收动作**:

    - `zone_reclaim()` 是触发区域回收的函数。
    - 它会调用 `shrink_zones()`，进而调用 `shrink_lruvec()` 来扫描 LRU (Least Recently Used) 链表，寻找可以被回收的页。
    - 根据 `zone_reclaim_mode` 的其他位 (如 `2` for writeback, `4` for swap)，`shrink_lruvec()` 会决定是否回写脏页或换出匿名页。

**总结一下，`zone_reclaim_mode` 的值直接决定了在页分配慢速路径中，当本地节点内存不足时，内核是立即跳转到 zonelist 中的下一个（可能是远程）节点，还是停留在当前节点，调用 `zone_reclaim()` 函数强制进行本地内存回收。**

---

### 实操建议

**警告：这是一个高级调优参数。在绝大多数情况下，保持默认值 `0` 是最好、最安全的选择。** 错误的设置很可能导致严重的性能问题。

1.  **何时考虑修改它？**

    - **前提条件**: 你的系统是 NUMA 架构，并且你的应用对内存访问延迟极度敏感。
    - **问题诊断**: 你通过工具（如 `numastat -m`）观察到了大量的 `numa_foreign` 或 `numa_miss` 计数，并且这些计数与应用性能下降（如延迟尖刺）有明确的关联。这意味着大量的跨节点内存访问正在损害你的应用。
    - **负载特性**: 应用负载被很好地隔离在各个 NUMA 节点上，节点之间几乎没有内存共享。例如，多个独立的、绑定到特定节点 CPU 的虚拟机或容器。

2.  **如何操作？**

    - **临时修改 (用于测试)**:
      ```bash
      echo 1 > /proc/sys/vm/zone_reclaim_mode
      ```
    - **永久修改**:
      编辑 `/etc/sysctl.conf` 文件，加入以下行：
      ```
      vm.zone_reclaim_mode = 1
      ```
      然后执行 `sysctl -p` 使其生效。

3.  **监控与评估**

    - 在修改前后，必须进行严格的基准测试和性能监控。
    - **使用 `numastat`**: 这是关键工具。
      ```bash
      # -m 显示系统范围的统计信息
      # watch -n 1 numastat -m
      ```
      观察 `numa_hit` 是否显著增加，`numa_miss` 和 `numa_foreign` 是否显著减少。
    - **使用 `vmstat`**:
      ```bash
      # watch -n 1 vmstat
      ```
      观察 `si` (swap in) 和 `so` (swap out) 列。如果开启 zone reclaim 后，这里的活动激增，说明你可能在换出有用的内存，这通常是性能变差的信号。
    - **观察 `pgscan`**:
      `cat /proc/vmstat | grep pgscan`
      观察 `pgscan_direct_` 和 `pgscan_kswapd_` 的增长率。如果 `pgscan_direct_` 增长很快，说明进程正在因为内存分配而被阻塞，等待直接回收完成，这会导致应用延迟。

4.  **风险与结论**

    - **最大的风险**: **性能悬崖 (Performance Cliff)**。你可能为了减少远程内存访问的微小延迟，而付出了强制回收热点缓存页的巨大代价，导致频繁的磁盘 I/O，性能不降反升，甚至出现系统抖动。
    - **现代内核的替代方案**: 现代 Linux 内核的 NUMA 调度和自动平衡机制已经相当智能。它们会尝试将进程迁移到其主要使用的内存所在的节点，或者将内存页迁移到访问它的进程所在的节点。通常，依赖内核的自动平衡比手动设置 `zone_reclaim_mode` 效果更好。

**最终建议：** 除非你是一个经验丰富的系统管理员，在特定的、经过深入分析的场景下（如 Oracle RAC 数据库有时会建议开启它），否则**不要修改 `zone_reclaim_mode`**。对于绝大多数通用负载，内核默认的跨节点分配策略都是更优的选择。
