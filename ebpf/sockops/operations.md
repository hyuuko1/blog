# 操作码全集参考手册

> **💡 本章你将理解：**
> - 全部 19 个 `BPF_SOCK_OPS_*` 操作码的触发时机、入参、返回值语义
> - 同步操作（返回决策值）与通知回调（仅观测/记录）的本质区别
> - 回调标志位如何精确控制通知回调的开关
> - 每个操作码的真实源码示例

---

## 一、操作码分类速览

sockops 的 19 个操作码分为四大类：

| 类别 | 操作码数 | 特征 | 典型场景 |
|---|---|---|---|
| **同步操作** | 4 | 内核调用后**等待** BPF 返回一个值；返回值直接参与 TCP 决策 | 设定 RTO 值、通告窗口、基础 RTT |
| **建连生命周期回调** | 4 | 在 TCP 连接创建关键点上强制触发 | 修改缓冲区、切换拥塞算法、插入 sockmap |
| **通知回调** | 4 | 需通过回调标志位**显式订阅**后才触发 | 监控重传、状态迁移、RTT 变化 |
| **头部选项回调** | 3 | 需通过回调标志位启用；读写 TCP 自定义头部选项 | 自定义 TCP 实验性选项 |
| **TX 时间戳回调** | 5 | 需通过 `SK_BPF_CB_TX_TIMESTAMPING` 启用；精细发包时间戳 | sendmsg 级别的延迟测量 |

---

## 二、返回值语义：`return 0/1` 与 `ctx->reply` 的协同

所有 sockops 程序遵循统一的返回约定，定义在 `tcp_call_bpf()` 中（`include/net/tcp.h:2905-2928`）：

```c
static inline int tcp_call_bpf(struct sock *sk, int op, u32 nargs, u32 *args)
{
    struct bpf_sock_ops_kern sock_ops;
    int ret;

    memset(&sock_ops, 0, offsetof(struct bpf_sock_ops_kern, temp));
    // ... 填充 sock_ops ...

    ret = BPF_CGROUP_RUN_PROG_SOCK_OPS(&sock_ops);  // 返回 BPF 程序返回值 (0 或 1)

    if (ret == 0)           // BPF 程序返回 0：事件未消费
        ret = sock_ops.reply;  // 仍然读取 reply 字段（同步操作中为默认值）
    else                    // BPF 程序返回 1：事件已消费
        ret = -1;            // tcp_call_bpf 返回 -1（表示失败/使用默认值）

    return ret;
}
```

⚠️ **易错点 —— 返回值二段论：**

| BPF 程序 `return` 值 | `tcp_call_bpf()` 返回值 | 含义 |
|---|---|---|
| `return 0` | `sock_ops.reply` 的值 | BPF 程序未消费事件；内核按默认逻辑使用 reply 做 fallback |
| `return 1` | `-1` | BPF 程序已消费事件；内核应使用 BPF 写入的 `reply` / `replylong` 作为决策依据 |

**关键推论：** 同步操作中，必须：
1. 向 `ctx->reply` 写入决策值
2. 让 BPF 程序 `return 1`

两者的缺一不可。只写 `reply` 但 `return 0` 会导致调用者拿到 `reply` 的值（恰好也有效，但语义不正确）。只 `return 1` 但不写 `reply` 会导致调用者拿到 `-1`（视为使用默认值）。

💡 **设计动机：** 为什么不让 BPF 程序直接返回 `reply` 值？因为 BPF 程序返回值只有 32 位——`0` 表示通过（PASS），非零表示丢弃（DROP）——这继承自 BPF 的包过滤根源。sockops 需要一个独立于"通过/丢弃"语义的通信通道来传递任意决策值（RTO 毫秒数、窗口大小等），于是 `reply` 字段就充当了这个角色。

---

## 三、同步操作

同步操作的共同特征：
- 内核在 TCP 决策点暂停，调用 BPF 程序
- BPF 程序通过 `ctx->reply` 返回决策值
- 内核直接消费返回值，不存储任何状态

### 3.1 `BPF_SOCK_OPS_TIMEOUT_INIT` (opcode=1)

```
触发时机: TCP 初始 SYN 超时值计算
调用位置: tcp_timeout_init() @ include/net/tcp.h:2964
调用代码:
    timeout = tcp_call_bpf(sk, BPF_SOCK_OPS_TIMEOUT_INIT, 0, NULL);
    if (timeout <= 0)
        timeout = TCP_TIMEOUT_INIT;    // 默认 1 秒
    return min_t(int, timeout, TCP_RTO_MAX);  // 上限 120 秒

入参 (args): 无
reply 期望:  SYN-RTO 值 (单位: jiffies), 或 -1 使用默认值
返回值消费:  用作 tcp_retries1 / tcp_retries2 的计算基准
```

**示例（同机房 IPv6 连接 10ms RTO）：**

```c
// source: samples/bpf/tcp_synrto_kern.c
case BPF_SOCK_OPS_TIMEOUT_INIT:
    if (skops->family == AF_INET6 &&
        skops->local_ip6[0] == skops->remote_ip6[0] &&
        (bpf_ntohl(skops->local_ip6[1]) & 0xfff00000) ==
        (bpf_ntohl(skops->remote_ip6[1]) & 0xfff00000))
        rv = 10;   // 同机房 → 10 jiffies (通常 = 10ms)
    break;
// ...
skops->reply = rv;
return 1;
```

### 3.2 `BPF_SOCK_OPS_RWND_INIT` (opcode=2)

```
触发时机: TCP 初始接收窗口大小计算
调用位置: tcp_rwnd_init_bpf() @ include/net/tcp.h:2975
调用代码:
    rwnd = tcp_call_bpf(sk, BPF_SOCK_OPS_RWND_INIT, 0, NULL);
    if (rwnd < 0)
        rwnd = 0;

入参 (args): 无
reply 期望:  初始通告窗口 (单位: 报文段数), 或 -1 使用默认值
返回值消费:  写入 tp->rcv_wnd，影响对端可发送的数据量
```

### 3.3 `BPF_SOCK_OPS_NEEDS_ECN` (opcode=5)

```
触发时机: 拥塞控制算法初始化时检查是否需要 ECN
调用位置: tcp_bpf_ca_needs_ecn() @ include/net/tcp.h:2986
调用代码:
    return (tcp_call_bpf(sk, BPF_SOCK_OPS_NEEDS_ECN, 0, NULL) == 1);

入参 (args): 无
reply 期望:  1 = 需要 ECN 支持, 0 或 -1 = 不需要
返回值消费:  决定是否为该连接启用 ECN 标记
```

⚠️ **易错点：** `NEEDS_ECN` 的调用者解析逻辑与其它同步操作不同——`tcp_bpf_ca_needs_ecn()` 只检查 `tcp_call_bpf() == 1`。这是因为：
1. `return 0` → `tcp_call_bpf()` 返回 `reply` 值（此时被设为 0 或 -1）→ `== 1` 为假
2. `return 1` → `tcp_call_bpf()` 返回 `-1` → `== 1` 为假

因此，正确的用法是：`ctx->reply = 1` + `return 0`（让 reply=1 穿透到调用者），或 `return 1`（导致 -1，等价于"不需要 ECN"）。

### 3.4 `BPF_SOCK_OPS_BASE_RTT` (opcode=6)

```
触发时机: 拥塞控制算法查询路径基础 RTT（通常用于 TCP-NV）
调用位置: 由拥塞控制模块通过 tcp_call_bpf() 调用
          具体调用点: net/ipv4/tcp_nv.c 中的 nv_init()

入参 (args): 无
reply 期望:  基础 RTT (单位: usec), 或 -1 使用默认值
返回值消费:  用作拥塞阈值——RTT 高于此值判定为拥塞发生
```

**示例（TCP-NV 同机房 base_rtt=80us）：**

```c
// source: samples/bpf/tcp_basertt_kern.c
case BPF_SOCK_OPS_BASE_RTT:
    n = bpf_getsockopt(skops, SOL_TCP, TCP_CONGESTION, cong, sizeof(cong));
    if (!n && !__builtin_memcmp(cong, "nv", sizeof("nv"))) {
        rv = 80;  // 同机房 → base RTT = 80us
    } else if (n) {
        rv = n;   // getsockopt 出错
    } else {
        rv = -1;  // 非 NV 算法 → 不覆盖
    }
    break;
```

---

## 四、建连生命周期回调

这些回调在 TCP 连接创建的关键点上**强制触发**（无需额外标志位），是对 cgroup 内所有 TCP 连接施加统一策略的最佳入口。

### 4.1 `BPF_SOCK_OPS_TCP_CONNECT_CB` (opcode=3)

```
触发时机: connect() → tcp_connect() 内部，SYN 即将发送
调用位置: tcp_connect() @ net/ipv4/tcp_output.c:4299
call 写法:  tcp_call_bpf(sk, BPF_SOCK_OPS_TCP_CONNECT_CB, 0, NULL);

入参 (args):   无
skb_data:      无 (SYN 尚未发送)
TCP 字段:      初值，尚未经历 RTT 测量
典型操作:      · 设置初始拥塞窗口 (TCP_BPF_IW)
               · 设置缓冲区大小 (SO_SNDBUF / SO_RCVBUF)
               · 调用 bpf_sock_ops_cb_flags_set() 启用后续通知
               · 调用 bpf_sock_map_update() 将 socket 加入 sockmap
sockmap 可用:  ❌ (不在允许的操作码列表中)
```

### 4.2 `BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB` (opcode=4)

```
触发时机: 主动端三次握手完成 → tcp_finish_connect() → tcp_init_transfer()
调用位置: tcp_init_transfer() @ net/ipv4/tcp_input.c:6715
call 写法:  tcp_call_bpf(sk, BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB, 0, NULL);

入参 (args):   无
skb_data:      指向完成三次握手的 SYNACK 包的 TCP 头部
TCP 字段:      已初始化 (srtt_us, mss_cache 等已就绪)
典型操作:      · 切换拥塞控制算法 (TCP_CONGESTION)
               · 修改缓冲区大小
               · 调用 bpf_sock_ops_cb_flags_set() 启用后续通知
               · 调用 bpf_sock_map_update() 将 socket 加入 sockmap
sockmap 可用:  ✅
```

### 4.3 `BPF_SOCK_OPS_PASSIVE_ESTABLISHED_CB` (opcode=5)

```
触发时机: 被动端三次握手完成 → tcp_rcv_state_process() → tcp_init_transfer()
调用位置: tcp_init_transfer() @ net/ipv4/tcp_input.c:7231
call 写法:  tcp_call_bpf(sk, BPF_SOCK_OPS_PASSIVE_ESTABLISHED_CB, 0, NULL);

入参 (args):   无
skb_data:      指向完成三次握手的 ACK 包的 TCP 头部
TCP 字段:      已初始化
典型操作:      与 ACTIVE_ESTABLISHED_CB 相同
sockmap 可用:  ✅
```

### 4.4 `BPF_SOCK_OPS_TCP_LISTEN_CB` (opcode=9)

```
触发时机: listen() 系统调用完成后
调用位置: inet_listen() @ net/ipv4/af_inet.c:229
call 写法:  tcp_call_bpf(sk, BPF_SOCK_OPS_TCP_LISTEN_CB, 0, NULL);

入参 (args):   无
skb_data:      无
TCP 字段:      LISTEN 状态的 socket (尚无连接)
典型操作:      · 预设将来被动建连时的参数
               · 将 listener socket 加入 sockmap
sockmap 可用:  ✅
```

💡 **设计动机 —— 为什么 ACTIVE 和 PASSIVE 是两个独立操作码？**
虽然是同一个函数 `tcp_init_transfer()` 触发的，但两者的上下文差异显著：
- **skb_data 指向不同**：主动端是 SYNACK，被动端是纯 ACK——TCP 选项内容不同
- **策略需求不同**：许多部署场景只需要干预 server 端（passive）连接的参数；client 端（active）连接可能是外部依赖
- **sockmap 场景差异**：负载均衡器通常在 server 端将被动建立的连接插入 sockmap，而不会将主动发起的出站连接插入同一个 map

---

## 五、通知回调（需回调标志位启用）

### 5.1 回调标志位机制

通知回调默认**不触发**。BPF 程序必须在建连回调（`TCP_CONNECT_CB` 或 `ACTIVE_ESTABLISHED_CB` 或 `PASSIVE_ESTABLISHED_CB`）中调用 `bpf_sock_ops_cb_flags_set()` 来设置标志位：

```c
// 在建连时订阅 RTO 和 STATE 通知
case BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB:
    bpf_sock_ops_cb_flags_set(skops,
        BPF_SOCK_OPS_RTO_CB_FLAG | BPF_SOCK_OPS_STATE_CB_FLAG);
    break;
```

标志位存储在 `tcp_sock->bpf_sock_ops_cb_flags`（`include/linux/tcp.h:487`），此后每次相应事件发生时，内核首先用一条位测试指令检查该标志：

```c
// tcp_bpf_rtt() @ include/net/tcp.h:2993
if (BPF_SOCK_OPS_TEST_FLAG(tcp_sk(sk), BPF_SOCK_OPS_RTT_CB_FLAG))
    tcp_call_bpf_2arg(sk, BPF_SOCK_OPS_RTT_CB, mrtt, srtt);
```

完整的回调标志位定义见下表：

| 标志位 | 位 | 启用操作码 | 内核检查点 |
|---|---|---|---|
| `BPF_SOCK_OPS_RTO_CB_FLAG` | 1<<0 | `RTO_CB` | `net/ipv4/tcp_timer.c:290` |
| `BPF_SOCK_OPS_RETRANS_CB_FLAG` | 1<<1 | `RETRANS_CB` | `net/ipv4/tcp_output.c:3678` |
| `BPF_SOCK_OPS_STATE_CB_FLAG` | 1<<2 | `STATE_CB` | `net/ipv4/tcp.c:2999` |
| `BPF_SOCK_OPS_RTT_CB_FLAG` | 1<<3 | `RTT_CB` | `include/net/tcp.h:2993` |
| `BPF_SOCK_OPS_PARSE_ALL_HDR_OPT_CB_FLAG` | 1<<4 | `PARSE_HDR_OPT_CB` (所有头) | `net/ipv4/tcp_input.c:148` |
| `BPF_SOCK_OPS_PARSE_UNKNOWN_HDR_OPT_CB_FLAG` | 1<<5 | `PARSE_HDR_OPT_CB` (仅未知) | `net/ipv4/tcp_input.c:148` |
| `BPF_SOCK_OPS_WRITE_HDR_OPT_CB_FLAG` | 1<<6 | `HDR_OPT_LEN_CB` + `WRITE_HDR_OPT_CB` | `net/ipv4/tcp_output.c:476` |
| `BPF_SOCK_OPS_ALL_CB_FLAGS` | 0x7F | 以上全部 | — |

### 5.2 `BPF_SOCK_OPS_RTO_CB` (opcode=7)

```
触发时机: RTO 重传定时器触发
调用位置: tcp_retransmit_timer() @ net/ipv4/tcp_timer.c:289-292
启用标志: BPF_SOCK_OPS_RTO_CB_FLAG

args[0]:  icsk->icsk_retransmits  (当前重传次数)
args[1]:  icsk->icsk_rto          (当前 RTO 值, jiffies)
args[2]:  expired (1=RTO 已到期, 0=探测定时器)

典型操作: · 记录 RTO 事件到 perf ring buffer (bpf_perf_event_output)
          · 根据重传次数动态调整参数
```

### 5.3 `BPF_SOCK_OPS_RETRANS_CB` (opcode=8)

```
触发时机: 单个 skb 被重传
调用位置: __tcp_retransmit_skb() @ net/ipv4/tcp_output.c:3678
启用标志: BPF_SOCK_OPS_RETRANS_CB_FLAG

args[0]:  seq  (重传段的起始序列号)
args[1]:  segs (本次重传的报文段数)
args[2]:  err  (tcp_transmit_skb 的返回值, 0=成功)

典型操作: · 按序列号跟踪哪些数据段发生了重传
```

### 5.4 `BPF_SOCK_OPS_STATE_CB` (opcode=10)

```
触发时机: TCP socket 状态发生变化
调用位置: tcp_set_state() @ net/ipv4/tcp.c:2998-2999
启用标志: BPF_SOCK_OPS_STATE_CB_FLAG

args[0]:  old_state  (迁移前的 TCP 状态, BPF_TCP_* 值)
args[1]:  new_state  (迁移后的 TCP 状态, BPF_TCP_* 值)

典型操作: · 记录 TCP 生命周期完整日志
          · 检测异常状态迁移 (如 CLOSE 前未经过 FIN_WAIT1)
```

BPF_TCP 状态枚举（`include/uapi/linux/bpf.h:7178-7194`），与内核内部 `TCP_*` 状态一一对应：

| BPF 状态 | 值 | 含义 |
|---|---|---|
| `BPF_TCP_ESTABLISHED` | 1 | 连接已建立 |
| `BPF_TCP_SYN_SENT` | 2 | SYN 已发送 |
| `BPF_TCP_SYN_RECV` | 3 | SYN 已接收 |
| `BPF_TCP_FIN_WAIT1` | 4 | 主动关闭第一步 |
| `BPF_TCP_FIN_WAIT2` | 5 | 等待对端 FIN |
| `BPF_TCP_TIME_WAIT` | 6 | TIME_WAIT 状态 |
| `BPF_TCP_CLOSE` | 7 | 完全关闭 |
| `BPF_TCP_CLOSE_WAIT` | 8 | 等待本地关闭 |
| `BPF_TCP_LAST_ACK` | 9 | 等待最终 ACK |
| `BPF_TCP_LISTEN` | 10 | 处于监听状态 |
| `BPF_TCP_CLOSING` | 11 | 双向关闭中 |

### 5.5 `BPF_SOCK_OPS_RTT_CB` (opcode=12)

```
触发时机: 每次 RTT 测量值更新后
调用位置: tcp_bpf_rtt() @ include/net/tcp.h:2993-2994
启用标志: BPF_SOCK_OPS_RTT_CB_FLAG

args[0]:  mrtt  (当前测量的 RTT, usec)
args[1]:  srtt  (更新后的平滑 RTT, usec << 3)

⚠️ 性能警示: RTT 在每个 ACK 时更新。在高速连接上 (如 10Gbps) RTT_CB 可能
              每秒触发数万次。务必确保 BPF 程序在此路径上极尽精简。
```

---

## 六、TX 时间戳回调

这组回调提供 sendmsg 级别的精确时间戳追踪，需通过 socket 选项启用：

```
启用方式:  bpf_setsockopt(skops, SOL_TCP, TCP_BPF_SOCK_OPS_CB_FLAGS,
                          &flags, sizeof(flags));
           flags = SK_BPF_CB_TX_TIMESTAMPING;

调度机制: bpf_skops_tx_timestamping() @ net/core/sock.c:944-954
          — 该函数独立于 tcp_call_bpf()，直接构造 bpf_sock_ops_kern 并调用
            __cgroup_bpf_run_filter_sock_ops()
```

| 操作码 | 值 | 触发时机 |
|---|---|---|
| `BPF_SOCK_OPS_TSTAMP_SCHED_CB` | 15 | skb 通过设备层调度 |
| `BPF_SOCK_OPS_TSTAMP_SND_SW_CB` | 16 | skb 即将交给 NIC（软件时间戳） |
| `BPF_SOCK_OPS_TSTAMP_SND_HW_CB` | 17 | 硬件时间戳阶段 |
| `BPF_SOCK_OPS_TSTAMP_ACK_CB` | 18 | 同一 sendmsg 调用的所有 skb 均已确认 |
| `BPF_SOCK_OPS_TSTAMP_SENDMSG_CB` | 19 | 每次 sendmsg 系统调用进入时 |

🔒 **并发安全警示：** `bpf_skops_tx_timestamping()` 不与 `tcp_call_bpf()` 共享路径——它不从 TCP 协议层调用，而是从 socket 发送路径（`__ip_append_data` 等）调用。这意味着它不持有 TCP 层的锁。它的 `bpf_sock_ops_kern` 构造也简化了（`is_fullsock=1` 直接硬编码，不做 `sock_owned_by_me` 断言）。

---

## 七、头部选项回调（概览）

头部选项回调在 `header-options.md` 中有完整深度解剖。此处给出速览：

| 操作码 | 值 | 方向 | 调用时机 | 核心辅助函数 |
|---|---|---|---|---|
| `PARSE_HDR_OPT_CB` | 11 | 收 | 收到已建连的包，解析 TCP 选项 | `bpf_load_hdr_opt()` |
| `HDR_OPT_LEN_CB` | 13 | 发前 | 构造发送包前，预留选项空间 | `bpf_reserve_hdr_opt()` |
| `WRITE_HDR_OPT_CB` | 14 | 发 | 写入 TCP 选项字节 | `bpf_store_hdr_opt()`, `bpf_load_hdr_opt()` |

三个操作码必须配合 `WRITE_HDR_OPT_CB_FLAG` + 解析标志位使用。典型流：

```
[建连] → bpf_sock_ops_cb_flags_set(WRITE_HDR_OPT_CB_FLAG | PARSE_UNKNOWN_HDR_OPT_CB_FLAG)
[发包] → HDR_OPT_LEN_CB → bpf_reserve_hdr_opt() 预留空间
       → WRITE_HDR_OPT_CB → bpf_store_hdr_opt() 写入选项
[收包] → PARSE_HDR_OPT_CB → bpf_load_hdr_opt() 读取选项
```

---

## 八、TCP_BPF_* Optname 速查

以下 `optname` 值仅可在 sockops 程序中通过 `bpf_setsockopt`/`bpf_getsockopt` 使用：

| optname | 值 | 方向 | 用途 |
|---|---|---|---|
| `TCP_BPF_IW` | 1001 | read/write | 初始拥塞窗口 |
| `TCP_BPF_SNDCWND_CLAMP` | 1002 | read/write | 拥塞窗口上限 |
| `TCP_BPF_DELACK_MAX` | 1003 | read/write | 最大延迟 ACK (us) |
| `TCP_BPF_RTO_MIN` | 1004 | read/write | 最小 RTO (us) |
| `TCP_BPF_SYN` | 1005 | read | 获取 TCP SYN 头部 |
| `TCP_BPF_SYN_IP` | 1006 | read | 获取 IP + TCP 头部 |
| `TCP_BPF_SYN_MAC` | 1007 | read | 获取 MAC + IP + TCP 头部 |
| `TCP_BPF_SOCK_OPS_CB_FLAGS` | 1008 | read/write | 回调标志位 (等价于 `bpf_sock_ops_cb_flags_set()`) |
| `SK_BPF_CB_FLAGS` | 1009 | read/write | TX 时间戳标志位 |
| `SK_BPF_BYPASS_PROT_MEM` | 1010 | write | 绕过 socket 内存保护 |

**常规 TCP optname**（`TCP_NODELAY`, `TCP_CONGESTION`, `TCP_MAXSEG` 等）也可在 sockops 程序中使用。

---

> **📝 一句话回顾：** 19 个操作码 = 4 个同步决策操作（内核等答案）+ 4 个建连强制回调（最佳策略注入点）+ 4 个通知订阅回调（位开关控制）+ 3 个头部选项读写操作 + 5 个发包时间戳——记住 `return 1` + `ctx->reply = value` 是同步操作的正确范式，而通知回调中的 `reply` 无意义。

接下来请阅读 [`execution-flow.md`](./execution-flow.md)，深入理解从 TCP 事件到 BPF 程序执行的完整树形调用链。
