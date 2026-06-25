# 自测清单

> **💡 本章你将理解：** 以下 20 道自测题覆盖了 sockops 的所有核心概念。若你能在闭卷条件下答对 80% 以上（16/20），则已掌握本分册的核心内容。

---

## 基础概念（每题 5 分，共 40 分）

**1.** sockops 程序附着在什么内核对象上？
- A. 每 socket
- B. cgroup
- C. netns
- D. 全局 sysctl

<details>
<summary>点击查看答案</summary>

**B. cgroup。** sockops 使用 `BPF_CGROUP_SOCK_OPS` 附着类型，绑定到 cgroup v2 目录上。该 cgroup 内所有进程创建的 TCP socket 均受该程序管辖。选择 cgroup 而非 per-socket 的原因是：策略按"进程组"（服务/容器）施加，且 cgroup 提供天然的层级继承。

</details>

---

**2.** 以下哪个字段在 `struct bpf_sock_ops` 上下文中**可写**？
- A. `snd_cwnd`
- B. `reply`
- C. `srtt_us`
- D. `state`

<details>
<summary>点击查看答案</summary>

**B. reply。** 以及 `sk_txhash`。由 `sock_ops_is_valid_access()` 在 `net/core/filter.c:9471-9480` 精确控制——只有 `reply` 和 `sk_txhash` 的写操作被允许。TCP 运行参数如 `snd_cwnd`、`srtt_us` 均为只读，需通过 `bpf_setsockopt()` 间接修改。

</details>

---

**3.** `bpftool cgroup attach /sys/fs/cgroup/myapp/ sock_ops pinned /sys/fs/bpf/prog` 这条命令的含义是什么？

<details>
<summary>点击查看答案</summary>

将 `/sys/fs/bpf/prog` 中的 sockops BPF 程序绑定到 cgroup `/sys/fs/cgroup/myapp/` 上。此后，属于该 cgroup 的进程创建的所有 TCP socket 都会在关键生命周期点触发该 BPF 程序。子 cgroup 继承父 cgroup 的 sockops 程序（除非子 cgroup 自己也有程序）。

</details>

---

**4.** `struct bpf_sock_ops` 中的 `op` 字段使用什么枚举类型赋值？

<details>
<summary>点击查看答案</summary>

`BPF_SOCK_OPS_*` 枚举，定义于 `include/uapi/linux/bpf.h:7039-7171`。包含 19 个操作码：4 个同步操作（`TIMEOUT_INIT`/`RWND_INIT`/`NEEDS_ECN`/`BASE_RTT`），4 个建连回调（`TCP_CONNECT_CB`/`ACTIVE_ESTABLISHED_CB`/`PASSIVE_ESTABLISHED_CB`/`TCP_LISTEN_CB`），4 个通知回调（`RTO_CB`/`RETRANS_CB`/`STATE_CB`/`RTT_CB`），3 个头部选项回调，5 个 TX 时间戳回调，以及 `VOID`。

</details>

---

**5.** 为什么 `bpf_sock_ops` 中的 `remote_port` 是网络字节序而 `local_port` 是主机字节序？

<details>
<summary>点击查看答案</summary>

因为它们分别来自内核中不同的存储格式：`remote_port` 从 `skc_dport` 读取（内核以网络字节序存储，避免路由查表时重复转换），`local_port` 从 `skc_num` 读取（以主机字节序存储，方便快速比较和哈希）。BPF 上下文选择忠实暴露内核存储格式（零拷贝），而非统一转换。

JIT 重写代码在 `net/core/filter.c:10816-10839`：`remote_port` 从 `skc_dport` 读后还做了左移 16 位的端序修正。

</details>

---

**6.** 以下 BPF 程序片段有什么问题？

```c
case BPF_SOCK_OPS_TIMEOUT_INIT:
    if (skops->remote_ip4 == bpf_htonl(0x0a000001))
        ctx->reply = 10;   // 同机房 → 10ms RTO
    return 0;
```

<details>
<summary>点击查看答案</summary>

**`return 0` 应为 `return 1`。** 同步操作中，BPF 程序必须同时满足两个条件：
1. `ctx->reply = value` — 写入决策值
2. `return 1` — 告诉内核"我已消费事件，请读取 reply"

当 `return 0` 时，`tcp_call_bpf()` 会返回 `sock_ops.reply` 的值（`include/net/tcp.h:2922-2926`），此时 reply=10 恰好也能被读取，但语义不正确——且 `return 0` 会让 `bpf_prog_run_array_cg` 继续执行链中的下一个程序，可能被覆盖。

</details>

---

**7.** 写出 `bpf_sock_ops` 上下文从 TCP 内核结构体中获取 `srtt_us` 的 JIT 重写过程（用伪代码描述即可）。

<details>
<summary>点击查看答案</summary>

`sock_ops_convert_ctx_access()` 在 `net/core/filter.c:10888` 中通过 `SOCK_OPS_GET_TCP_SOCK_FIELD(srtt_us)` 宏生成以下逻辑：

```
r9 = ctx->is_locked_tcp_sock    // 检查是否持锁
if r9 == 0 goto zero_out        // 未持锁→返回0
r1 = ctx->sk                     // 获取 socket 指针
r1 = *(u32 *)(r1 + tcp_sock.srtt_us_offset)  // 通过 tcp_sock 偏移直接读
goto done
zero_out:
r1 = 0
done:
```

关键是加载时通过 `SOCK_OPS_GET_FIELD` 宏(第10580行)生成的零保护分支——如果 `is_locked_tcp_sock` 为假（request_sock 场景），返回 0 而非读取未初始化内存。

</details>

---

**8.** `tcp_call_bpf()` 中对 `bpf_sock_ops_kern` 的 memset 为什么停在 `temp` 字段前？

<details>
<summary>点击查看答案</summary>

```c
memset(&sock_ops, 0, offsetof(struct bpf_sock_ops_kern, temp));
```

`temp` 及其后的字段是 JIT 代码生成时的"借条寄存器"——JIT 生成的指令需要在 `temp` 字段中保存和恢复某个 BPF 寄存器的值。如果 memset 包含了 `temp`，JIT 依赖的暂存值会被清零，导致字段访问结果不正确。

源码注释明确警告（`include/linux/filter.h:1590-1598`）：`temp` 及其后字段不会被初始化为 0，新字段若需要 0 初值应插入在 `temp` 之前。

</details>

---

## 进阶应用（每题 10 分，共 80 分）

**9.** 如下程序在 `ACTIVE_ESTABLISHED_CB` 中调用 `bpf_sock_ops_cb_flags_set(ctx, BPF_SOCK_OPS_STATE_CB_FLAG)`。请问 `STATE_CB` 会在本次连接建立的 `ESTABLISHED` 状态迁移时触发吗？

<details>
<summary>点击查看答案</summary>

**不会。** 时序如下：

1. `tcp_finish_connect()` 中先调用 `tcp_set_state(TCP_ESTABLISHED)` → 如果此时 STATE_CB_FLAG 已设置，STATE_CB 会触发。但建连前尚未设置该标志位。
2. 然后 `tcp_init_transfer(ACTIVE_ESTABLISHED_CB)` 被调用，此时 BPF 程序执行 `bpf_sock_ops_cb_flags_set()`。
3. 标志位设置完毕，但 `ESTABLISHED` 状态迁移已经发生过了。

**STATE_CB 会在后续状态迁移（如 ESTABLISHED → FIN_WAIT1 → FIN_WAIT2 → TIME_WAIT）时触发。** 如果需要在首次建连时也记录状态迁移，应当在 `TCP_CONNECT_CB` 中设置标志位（因为 `TCP_CONNECT_CB` 发生在 `tcp_set_state(TCP_SYN_SENT)` 之前）。

</details>

---

**10.** 在 `HDR_OPT_LEN_CB` 中调用 `bpf_load_hdr_opt()` 会返回什么？为什么？

<details>
<summary>点击查看答案</summary>

**返回 `-EPERM`。**

`bpf_sock_ops_load_hdr_opt()` 在 `net/core/filter.c:7852-7854` 中有显式检查：

```c
if (!bpf_sock->skb ||
    bpf_sock->op == BPF_SOCK_OPS_HDR_OPT_LEN_CB)
    return -EPERM;
```

原因：`HDR_OPT_LEN_CB` 发生在 TCP 头部尚未构造完成时——此时 `skb_data` 指向的数据还没有任何 TCP 选项。在这个阶段读取头部选项在物理上没有意义。

</details>

---

**11.** sockops 程序用 `bpf_sock_map_update(ctx, &map, &key, BPF_NOEXIST)` 在 `TCP_CONNECT_CB` 中插入 socket。调用返回 `-EOPNOTSUPP`。为什么？

<details>
<summary>点击查看答案</summary>

`sock_map_op_okay()` 在 `net/core/sock_map.c:521-526` 中仅白名单三个操作码：

```c
return ops->op == BPF_SOCK_OPS_PASSIVE_ESTABLISHED_CB ||
       ops->op == BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB ||
       ops->op == BPF_SOCK_OPS_TCP_LISTEN_CB;
```

`TCP_CONNECT_CB` 不在其中。原因：
- 此时 socket 尚未进入 ESTABLISHED 状态，如果 sk_skb 程序误将流量重定向到此 socket，TCP 栈会丢弃
- socket 的状态和参数（MSS、窗口缩放等）尚未就绪
- 内核要求在"转发者"视角下，sockmap 中的 socket 必须处于可转发状态

**修复：将 `bpf_sock_map_update()` 移到 `ACTIVE_ESTABLISHED_CB` 或 `PASSIVE_ESTABLISHED_CB` 中。**

</details>

---

**12.** 用 `bpftool` 命令验证 sockops 程序是否正确 attach 到 cgroup，并列出该 cgroup 上所有 BPF 程序。

<details>
<summary>点击查看答案</summary>

```bash
# 查看指定 cgroup 上的 BPF 程序
$ bpftool cgroup show /sys/fs/cgroup/unified/

# 预期输出示例：
# ID       AttachType      AttachFlags     Name
# 42       sock_ops        multi           sockops_handler

# 查看程序详情（验证类型和链接数）
$ bpftool prog show id 42

# 列出所有 sock_ops 类型程序
$ bpftool prog show | grep sock_ops
```

</details>

---

**13.** `bpf_sock_ops_cb_flags_set(ctx, BPF_SOCK_OPS_RTT_CB_FLAG)` 被调用后，`RTT_CB` 回调的触发频率大约是多少？在 10Gbps TCP 连接上这会导致什么性能问题？

<details>
<summary>点击查看答案</summary>

**触发频率：每个 ACK 一次。**

TCP 的 RTT 测量在每个 ACK 到达时更新（严格说是每 RTT 至少一次，但实现上是每个有 ACK 的包都测）。在 10Gbps 连接上，ACK 频率可达每秒数万次。

性能问题：
1. 每次 RTT 更新都触发 `tcp_call_bpf()` → cgroup 查找 → BPF 程序执行（即使程序只有 5 条指令）
2. 这发生在 TCP 最热的路径上（`tcp_ack()` → `tcp_clean_rtx_queue()` → `tcp_bpf_rtt()`）
3. 即使 BPF 程序只做 `return 0`，cgroup 查找和 BPF 程序调用开销也在 1-3us 量级
4. 在高速连接上，这可能导致吞吐量下降 10-30%

**生产环境推荐：默认关闭 `RTT_CB_FLAG`，只在需要精确定位 RTT 异常时临时启用。**

</details>

---

**14.** 在 `WRITE_HDR_OPT_CB` 中调用 `bpf_store_hdr_opt()`，第一次调用返回 0，第二次调用相同 Kind+Magic 的选项返回 `-EEXIST`。解释这个行为。

<details>
<summary>点击查看答案</summary>

`bpf_sock_ops_store_hdr_opt()` 在 `net/core/filter.c:7928-7935` 中实现了去重检查：

```c
op = bpf_search_tcp_opt(op, opend, new_kind, magic, magic_len, &eol);
if (!IS_ERR(op))
    return -EEXIST;   // 已存在相同 Kind (+ Magic) 的选项
```

内核在调用 BPF 程序之前已经写入了自己的 TCP 选项。去重检查扫描 `skb_data ~ skb_data_end` 范围内的所有已写入选项（包括内核写的和 BPF 之前写的），防止同一 SKB 中出现两个相同的自定义选项。

对于实验性选项（`TCPOPT_EXP=254` 或 253），去重匹配的是 `Kind + 2字节 Magic Number`（RFC 6994 行为）。对于普通 Kind，仅匹配 Kind 值。

**修复：确保每次 `WRITE_HDR_OPT_CB` 中每个 Kind+Magic 组合只写入一次。**

</details>

---

**15.** 在 SYN Cookie 模式下，sockops 程序在 `HDR_OPT_LEN_CB`（`args[0] = BPF_WRITE_HDR_TCP_SYNACK_COOKIE`）中写入的自定义选项在连接建立后是否保证存在？应该如何设计以应对这种不确定性？

<details>
<summary>点击查看答案</summary>

**不保证存在。** SYN Cookie 模式下：
1. Server 将连接状态编码进 SYNACK 序列号，不保存 SYN 数据
2. 如果 Client 的 ACK 中 Cookie 验证失败，Server 重新生成 SYNACK——此时可能不带 BPF 选项
3. 即使 Cookie 验证成功，连接升级为 ESTABLISHED 后，首次 SYNACK 中写入的选项可能不被保留

**推荐设计：**
- 不依赖 SYN Cookie 路径下的选项持久化
- 所有关键策略（RTO、缓冲区、拥塞算法）通过 `bpf_setsockopt()` 在 `ACTIVE_ESTABLISHED_CB` / `PASSIVE_ESTABLISHED_CB` 中施加——这是确定性的
- 头部选项仅用于"尽力而为"的信息传递（如 TOS 反射、连接标识），接受可能丢失
- Active 端应保持 `PARSE_ALL_HDR_OPT_CB_FLAG` 打开，回读自己的选项以检测丢失

</details>

---

**16.** 写出一个在 `ACTIVE_ESTABLISHED_CB` 中同时设置缓冲区大小、拥塞控制算法和订阅 `STATE_CB` + `RTO_CB` 通知的完整 sockops 代码片段。

<details>
<summary>点击查看答案</summary>

```c
SEC("sockops")
int handle_connect(struct bpf_sock_ops *skops)
{
    int bufsize = 1500000;
    char cc[] = "bbr";
    int rv = 0;

    switch (skops->op) {
    case BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB:
        /* 设置缓冲区 */
        rv = bpf_setsockopt(skops, SOL_SOCKET, SO_SNDBUF,
                            &bufsize, sizeof(bufsize));
        rv += bpf_setsockopt(skops, SOL_SOCKET, SO_RCVBUF,
                             &bufsize, sizeof(bufsize));

        /* 切换拥塞控制 */
        rv += bpf_setsockopt(skops, SOL_TCP, TCP_CONGESTION,
                             cc, sizeof(cc));

        /* 设置初始拥塞窗口 */
        int iw = 20;
        rv += bpf_setsockopt(skops, SOL_TCP, TCP_BPF_IW,
                             &iw, sizeof(iw));

        /* 订阅后续通知 */
        rv += bpf_sock_ops_cb_flags_set(skops,
            BPF_SOCK_OPS_STATE_CB_FLAG |
            BPF_SOCK_OPS_RTO_CB_FLAG);
        break;

    case BPF_SOCK_OPS_STATE_CB:
        bpf_printk("state: %d -> %d\n",
                   skops->args[0], skops->args[1]);
        break;

    case BPF_SOCK_OPS_RTO_CB:
        bpf_printk("RTO: retrans=%d rto=%d expired=%d\n",
                   skops->args[0], skops->args[1], skops->args[2]);
        break;

    default:
        break;
    }
    return 1;
}
```

</details>

---

**17.** 解释 `remote_port` 在 JIT 中为什么要左移 16 位（见 `net/core/filter.c:10826` 的 `BPF_ALU32_IMM(BPF_LSH, si->dst_reg, 16)`）。

<details>
<summary>点击查看答案</summary>

`skc_dport` 在内核中存储为 `__be16`（2 字节网络字节序）。当 JIT 用 `BPF_LDX_MEM(BPF_H, ...)` 把它读入一个 32 位寄存器时，值在高 16 位（因为网络字节序的大端 2 字节在小端机器上会被放在高位）。

但 BPF 程序期望 `remote_port` 是 `__u32` 网络字节序——即 2 字节端口值放在低 16 位（`0x0000XXXX`）。因此这条 `BPF_LSH 16` 左移指令将高 16 位的值移到低 16 位，实现格式统一。

该移位仅在 `#ifndef __BIG_ENDIAN_BITFIELD`（小端机器）时执行。在大端机器上，2 字节网络序值天然在低 16 位，无需移位。

</details>

---

**18.** 进程 A 在 cgroup `/sys/fs/cgroup/parent/child/` 中，该 cgroup 上挂载了 sockops 程序。若管理员将进程 A 迁移到另一个 cgroup（没有 sockops 程序），哪些 socket 会受影响？

<details>
<summary>点击查看答案</summary>

- **新创建的 socket**：受新 cgroup 的策略管辖（无 sockops 程序 → 不触发回调）
- **已创建的 socket**：**不受影响。** socket 的 cgroup 归属在 `sk_alloc()` 时通过 `memcpy(&sk->cgrp_data, &current->cgrp_data, ...)` 固化。一旦分配完成，socket 的 cgroup 归属不可改变。这避免了"连接进行中被切换策略"。

设计动机：如果迁移影响已建立的连接，可能导致已设置的 `bpf_sock_ops_cb_flags` 与新 cgroup 的策略冲突，或者在连接中间切换 RTO 值造成紊乱。

</details>

---

## 综合分析（每题 20 分，共 40 分）

**19.** 设计一个方案：使用 sockops + sockmap 实现内核态 TCP 反向代理，满足以下需求：
- Listener 在 80 端口接受连接
- 新建立的 backend socket 按 `(client_port % N)` 分配到 N 个后端之一
- 后续流量在 listener 和 backend 之间透明转发
- Backend socket 关闭时自动从 sockmap 移除

请描述所需的 BPF 程序（类型、附着方式、关键代码逻辑）。

<details>
<summary>点击查看答案</summary>

**方案设计：**

**程序 1: sockops（控制平面）**
- 附着：cgroup（含 listener 进程）
- 逻辑：
```c
case BPF_SOCK_OPS_PASSIVE_ESTABLISHED_CB: {
    __u32 key = skops->remote_port % N;
    bpf_sock_map_update(skops, &sock_map, &key, BPF_ANY);
    break;
}
```
- 当 server 被动建立连接时，按 `client_port % N` 作为 key 将新 socket 插入 sockmap

**程序 2: sk_skb（数据平面）**
- 附着：sockmap（作为 stream_parser）
- Ingress 逻辑：
```c
SEC("sk_skb")
int redirect_ingress(struct __sk_buff *skb) {
    __u32 key = skb->remote_port % N;
    return bpf_sk_redirect_map(skb, &sock_map, key, 0);
}
```
- Egress 逻辑：
```c
SEC("sk_skb")
int redirect_egress(struct __sk_buff *skb) {
    return bpf_sk_redirect_map(skb, &sock_map, skb->local_port % N, BPF_F_INGRESS);
}
```

**加载流程：**
```bash
$ bpftool prog load sockops.o /sys/fs/bpf/sops type sockops
$ bpftool cgroup attach $CGROUP sock_ops pinned /sys/fs/bpf/sops
$ bpftool prog load skb_prog.o /sys/fs/bpf/skb_ingress type sk_skb \
         map name sock_map pinned /sys/fs/bpf/sm
$ bpftool prog attach pinned /sys/fs/bpf/skb_ingress sk_skb_stream_verdict \
         pinned /sys/fs/bpf/sm
```

**自动清理：** Backend socket 关闭时，`sk_psock_drop()` 自动将其从所有关联的 sockmap 中移除，无需 BPF 程序显式删除。

**局限：** `client_port % N` 作为 key 存在哈希冲突——多个 client socket 可能映射到同一个 key，导致旧 socket 被替换。生产方案应使用 `BPF_MAP_TYPE_SOCKHASH` + 更细粒度的 key（如 `hash(client_ip, client_port)`）。

</details>

---

**20.** 你的团队在生产集群中部署了一个 sockops 程序用于 TCP RTO 定制。一周后收到告警：某服务的 P99 延迟从 50ms 飙升到 800ms。请按照本章的排障决策树，写出你的排查步骤和可能根因。

<details>
<summary>点击查看答案</summary>

**排查步骤：**

**第 1 步：验证程序是否被意外 detach**
```bash
$ bpftool cgroup show /sys/fs/cgroup/service.slice/
# 确认 sockops 程序仍在
```

**第 2 步：检查 RTO_CB_FLAG 是否意外启用**
```bash
$ bpftrace -e '
    kfunc:tcp_call_bpf /args->op == 7/ { @rto = count(); }
    interval:s:10 { print(@rto); }'
# 如果 RTO_CB 频繁触发 → 程序可能在 RTO_CB 路径上做了重操作
```

**第 3 步：测量 sockops 程序的执行延迟**
```bash
$ bpftrace -e '
    kfunc:tcp_call_bpf { @start[tid] = nsecs; }
    kretfunc:tcp_call_bpf /@start[tid]/ {
        $d = (nsecs - @start[tid]) / 1000;
        @lat = hist($d);
        delete(@start[tid]);
    }'
```

**第 4 步：检查 RTO_CB 是否在高频连接上被启用**
```bash
$ bpftrace -e '
    kfunc:bpf_sock_ops_cb_flags_set {
        printf("pid=%d flags=0x%x\n", pid, args->flags);
    }'
```

**可能根因分析：**

1. **RTT_CB_FLAG 被误开启**（最可能）：开发者在建连回调中错误地设置了 `BPF_SOCK_OPS_RTT_CB_FLAG`。每个 ACK 都触发 BPF 程序（即使程序只有 3 条指令），在 10Gbps 连接上每秒触发数万次 → cgroup 查找 + BPF 执行延迟累积 → P99 飙升。
   - 修复：`bpf_sock_ops_cb_flags_set(ctx, flags & ~BPF_SOCK_OPS_RTT_CB_FLAG)` 关闭标志位。

2. **bpf_setsockopt 设置了过大的 RTO 值**：`TCP_BPF_RTO_MIN` 以 microseconds 为单位，如果误用了 milliseconds → RTO 最小值被设为 200ms 而非 200us → 每次超时等待时间延长 1000x → 延迟飙升。
   - 修复：确认单位是 microseconds。

3. **bpf_perf_event_output 在 RTO_CB 路径上被调用**：向 perf ring buffer 写入数据涉及内存分配和锁竞争，在重传路径上执行 → TCP 栈暂停等锁 → 延迟恶化。
   - 修复：将日志记录移到用户态或使用 eBPF ring buffer（kernel 5.8+），或仅在采样子集上记录。

4. **sockmap 插入的 socket 数量超标**：`bpf_sock_map_update` 在每连接上都执行，`max_entries` 耗尽 → 插入失败不断重试 → 建连延迟增加。
   - 修复：检查 `max_entries`，使用 `BPF_ANY` 标志避免失败重试。

</details>

---

## 计分表

| 分数 | 等级 | 建议 |
|---|---|---|
| 180-200 | **精通** | 你已全面掌握 sockops，可以开始贡献内核 patch 或设计生产级 BPF 方案 |
| 140-179 | **熟练** | 核心概念扎实，建议重做错题并回顾对应章节 |
| 100-139 | **入门** | 建议完整重读 `design-and-data.md` / `operations.md` / `execution-flow.md` |
| <100 | **初学者** | 建议从 `introduction.md` 开始重新系统性学习 |

---

> **📝 一句话回顾：** 这 20 道题检验了你对 sockops 的 19 个操作码、JIT 重写机制、cgroup 绑定模型、sockmap 联动、头部选项读写、以及排障调优的全维度理解——真正的精通不在于记住所有 API，而在于能对任何一个"为什么这个程序不 work"的问题追溯到对应的内核源码行。

接下来请阅读 [`advanced-topics.md`](./advanced-topics.md)。
