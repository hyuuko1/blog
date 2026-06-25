# 排障决策树与调优

> **💡 本章你将理解：**
> - 当 sockops 程序在生产环境表现异常时的系统化排查路径
> - 使用 ftrace/bpftrace/perf 诊断 sockops 程序的关键命令
> - 最常见的配置错误及其修复方案

---

## 一、排障决策树总览

```
问题现象
│
├─ "程序没有触发"
│   ├─ cgroup attach 是否正确？             → §2.1
│   ├─ 程序是否通过了 BPF 验证器？          → §2.2
│   └─ socket 是否属于正确的 cgroup？       → §2.3
│
├─ "返回值没有生效"
│   ├─ 同步操作：return 1 + 写 reply？      → §3.1
│   ├─ 通知回调：标志位是否已设置？          → §3.2
│   └─ 参数单位是否正确 (jiffies vs usec)？ → §3.3
│
├─ "性能下降"
│   ├─ RTT_CB 是否在高速连接上启用？        → §4.1
│   ├─ skb_data 边界检查开销？              → §4.2
│   └─ sockmap 插入是否在每连接都执行？     → §4.3
│
├─ "bpf_sock_map_update 返回 -EOPNOTSUPP"
│   └─ 操作码是否符合白名单？               → §5.1
│
├─ "bpf_load_hdr_opt 返回 -EPERM"
│   └─ 是否在 HDR_OPT_LEN_CB 中调用？       → §5.2
│
└─ "连接泄漏 / sockmap 中残留 socket"
    └─ 是否依赖 socket 自动清理？           → §5.3
```

---

## 二、程序未触发的排查

### 2.1 验证 cgroup attach 状态

```bash
# 查看 cgroup 上挂载的所有 BPF 程序
$ bpftool cgroup show /sys/fs/cgroup/unified/

# 预期输出示例:
#   ID       AttachType      AttachFlags     Name
#   42       sock_ops        multi           sockops_handler

# 查看程序详细信息
$ bpftool prog show id 42

# 查看程序是否被引用（链接数 > 0）
$ bpftool prog show id 42 --json | jq '.pinned, .link'
```

⚠️ **易错点 —— cgroup v1 vs v2：** sockops 仅支持 cgroup v2（unified hierarchy）。在 cgroup v1 上 attach 会静默失败。验证：
```bash
$ stat -fc %T /sys/fs/cgroup/unified/
cgroup2fs   # ← 必须是 cgroup2fs
```

### 2.2 验证 BPF 程序加载成功

```bash
# 检查验证器日志
$ bpftool prog load sockops_prog.o /sys/fs/bpf/prog type sockops 2>&1

# 常见验证错误:
# "invalid access to packet" → skb_data 未做边界检查
# "invalid access to sock_ops" → 写入了只读字段
# "back-edge from insn ..." → 使用了循环（sockops 不允许）
```

### 2.3 确认 socket 归属的 cgroup

```bash
# 查找进程的 cgroup
$ cat /proc/$PID/cgroup

# 使用 bpftrace 跟踪目标进程创建的 socket
$ bpftrace -e '
    kfunc:__cgroup_bpf_run_filter_sock_ops
    /comm == "nginx"/ {
        printf("pid=%d cgrp=%s op=%d\n",
               pid, str(args->sk->sk_cgrp_data...), args->sock_ops->op);
    }'
```

### 2.4 检查内核编译选项

```bash
# 必须启用的内核选项
$ grep CONFIG_CGROUP_BPF /boot/config-$(uname -r)
CONFIG_CGROUP_BPF=y
$ grep CONFIG_BPF_SYSCALL /boot/config-$(uname -r)
CONFIG_BPF_SYSCALL=y
$ grep CONFIG_INET /boot/config-$(uname -r)
CONFIG_INET=y
```

---

## 三、返回值未生效的排查

### 3.1 同步操作的返回范式

**问题：** `bpf_setsockopt` 设置了 `TCP_BPF_RTO_MIN`，但 `sockops` 返回后 RTO 还是默认值。

**根因诊断：**

```c
// ❌ 错误写法：
case BPF_SOCK_OPS_TIMEOUT_INIT:
    ctx->reply = 10;    // 写了 reply
    return 0;           // 但 return 0 → ctx->reply 被忽略!

// ✅ 正确写法：
case BPF_SOCK_OPS_TIMEOUT_INIT:
    ctx->reply = 10;
    return 1;           // return 1 → 内核读取 ctx->reply
```

验证这种错误的诊断命令：

```bash
# 跟踪 tcp_call_bpf 的返回值
$ bpftrace -e '
    kretfunc:tcp_call_bpf
    /retval >= 0/ {
        printf("tcp_call_bpf ret=%d\n", retval);
    }'
# retval = -1 表示 return 1 (被转为 -1, 但 reply 生效)
# retval >= 0 表示 return 0 (返回了 reply 值本身)
```

### 3.2 通知回调的标志位排查

```bash
# 检查 tcp_sock 中 bpf_sock_ops_cb_flags 的实际值
$ bpftrace -e '
    kfunc:tcp_call_bpf
    /args->op == 7/ {  // RTO_CB
        $tp = (struct tcp_sock *)args->sk;
        printf("cb_flags=0x%x op=%d\n", $tp->bpf_sock_ops_cb_flags, args->op);
    }'
```

⚠️ **易错点 —— 回调标志位的执行顺序：**
`TCP_CONNECT_CB` 在 `bpf_sock_ops_cb_flags_set()` **之前**触发。不能在建连回调中设置标志位再期望它在**同一次建连回调**中的 `STATE_CB` 生效——因为 `STATE_CB` 在此刻已经触发过了。正确做法是在 **`ACTIVE_ESTABLISHED_CB` 中设置标志位**，后续的状态迁移才会触发 `STATE_CB`。

### 3.3 参数单位错误

| 操作 | 期望单位 | 常见误用 |
|---|---|---|
| `TIMEOUT_INIT` reply | jiffies (通常 1ms=1jiffy) | 将 millisecond 当做 jiffy 使用 (HZ=1000 时可互换) |
| `BASE_RTT` reply | microseconds | 使用 jiffies |
| `RTT_CB` args[0] | microseconds | 当做 jiffies 读取 |
| `TCP_BPF_DELACK_MAX` | microseconds | 使用 jiffies |
| `TCP_BPF_RTO_MIN` | microseconds | 使用 jiffies |

---

## 四、性能问题排查

### 4.1 RTT_CB 的高频触发

```bash
# 测量 RTT_CB 的触发频率
$ bpftrace -e '
    kfunc:tcp_call_bpf
    /args->op == 12/ {  // RTT_CB
        @rtt_count = count();
    }
    interval:s:1 {
        print(@rtt_count);
        clear(@rtt_count);
    }'

# 如果输出 > 10000/s → 在高速连接上建议关闭 RTT_CB_FLAG
```

### 4.2 sockops 程序本身的执行时间

```bash
# 使用 bpftrace 测量 sockops 程序的整体耗时
$ bpftrace -e '
    kfunc:__cgroup_bpf_run_filter_sock_ops {
        @start[tid] = nsecs;
    }
    kretfunc:__cgroup_bpf_run_filter_sock_ops
    /@start[tid]/ {
        $dur = nsecs - @start[tid];
        @lat_us = hist($dur / 1000);
        delete(@start[tid]);
    }'

# @lat_us 直方图的 90 分位 > 50us → 程序可能需要优化
```

### 4.3 sockmap 插入的性能开销

```bash
# 测量 bpf_sock_map_update 的耗时和频率
$ bpftrace -e '
    kfunc:bpf_sock_map_update {
        @count = count();
        @start[tid] = nsecs;
    }
    kretfunc:bpf_sock_map_update
    /@start[tid]/ {
        $dur = nsecs - @start[tid];
        @lat = hist($dur / 1000);
        delete(@start[tid]);
    }'
```

💡 **性能优化提示：**
- sockmap 插入涉及 `sk_psock_init()` → 协议替换 → 内存分配。在新连接速率 >1000 conn/s 时，考虑用 `BPF_MAP_TYPE_SOCKHASH` 替代 `SOCKMAP`（动态分配比固定数组更有弹性）
- 避免在 `ACTIVE_ESTABLISHED_CB` **和** `PASSIVE_ESTABLISHED_CB` **两个**回调中都做 sockmap 插入——选一个即可
- sk_skb 重定向的开销约为 1-3us（不含 BPF 程序自身执行时间）

---

## 五、常见错误码速查与修复

### 5.1 `bpf_sock_map_update` → `-EOPNOTSUPP`

```
含义: 当前 sockops 操作码不在白名单中
发生场景:
  1. 在 TCP_CONNECT_CB 中调用了 bpf_sock_map_update()   → 移到 ESTABLISHED_CB
  2. 在 STATE_CB / RTO_CB 中调用                         → 移除调用
  3. socket 类型不支持 psock 升级 (非 TCP/IP socket)     → 检查协议类型
```

### 5.2 `bpf_load_hdr_opt` → `-EPERM`

```
含义: 在不允许的操作中调用了 load_hdr_opt
发生场景:
  1. 在 HDR_OPT_LEN_CB 中调用 load_hdr_opt()
     → 此时 skb 数据尚未写入，无法读取
     → 移到 PARSE_HDR_OPT_CB 或 WRITE_HDR_OPT_CB 中
  2. skb 为空 (skb_data == NULL)
     → 当前操作码不支持 skb 数据
```

### 5.3 `bpf_store_hdr_opt` → `-EEXIST`

```
含义: 检测到重复选项 (相同 Kind + Magic 已被写入)
修复:
  → 检查是否在同一个 HDR_OPT_LEN_CB/WRITE_HDR_OPT_CB 周期中写了两次相同选项
  → 避免在 PARSE_HDR_OPT_CB 中误调 store_hdr_opt
```

### 5.4 `bpf_reserve_hdr_opt` / `bpf_store_hdr_opt` → `-ENOSPC`

```
含义: 选项空间不足
修复:
  → 检查 remaining_opt_len 的日志值
  → 减少内核 TCP 选项 (关闭 Timestamp 等)
  → 减小自定义选项长度
```

### 5.5 sockmap 中残留已关闭的 socket

```
现象: sockmap lookup 返回的 socket 已处于 CLOSE_WAIT/TIME_WAIT
根因: 虽然 sk_psock_drop() 在 close 时自动触发, 但存在竞态窗口
修复: 在 sk_skb 程序中使用 sock_map_redirect_allowed() 等价的检查
      或者使用 bpf_sk_assign() (更安全的新 API, kernel 5.10+)
```

---

## 六、诊断工具命令速查

### 6.1 bpftool 诊断套件

```bash
# 列出所有 sock_ops 程序
$ bpftool prog show | grep sock_ops

# 查看程序的反汇编 (JIT 后的 x86 指令)
$ bpftool prog dump xlated id 42

# 查看程序的 JIT 编译结果 (原生指令)
$ bpftool prog dump jited id 42

# 查看程序关联的 map
$ bpftool prog show id 42 --json | jq '.map_ids'

# 查看 sockmap 内容
$ bpftool map dump id 10
```

### 6.2 ftrace 跟踪关键函数

```bash
# 跟踪 tcp_call_bpf 所有调用
$ echo 'tcp_call_bpf' > /sys/kernel/debug/tracing/set_ftrace_filter
$ echo 'function' > /sys/kernel/debug/tracing/current_tracer
$ echo 1 > /sys/kernel/debug/tracing/tracing_on
$ cat /sys/kernel/debug/tracing/trace

# 跟踪 cgroup bpf 调度
$ echo '__cgroup_bpf_run_filter_sock_ops' >> /sys/kernel/debug/tracing/set_ftrace_filter

# 跟踪 sock_map_update 操作
$ echo 'sock_map_update_common' >> /sys/kernel/debug/tracing/set_ftrace_filter
```

### 6.3 bpftrace 诊断脚本

```bash
# 🔍 脚本1: 监控所有 sockops 操作码的触发频率
$ bpftrace -e '
    kfunc:tcp_call_bpf {
        @opcodes[args->op] = count();
    }
    END { print(@opcodes); }'

# 🔍 脚本2: 检查哪个 cgroup 触发了 sockops
$ bpftrace -e '
    kfunc:__cgroup_bpf_run_filter_sock_ops {
        $cgrp = args->sk->sk_cgrp_data.cgroup;
        printf("cgrp=%llx op=%d\n", $cgrp, args->sock_ops->op);
    }'

# 🔍 脚本3: 检查 bpf_setsockopt 的调用参数
$ bpftrace -e '
    kfunc:bpf_sock_ops_setsockopt {
        printf("level=%d optname=%d optval=%d\n",
               args->level, args->optname, *(uint32*)args->optval);
    }'

# 🔍 脚本4: 跟踪 TCP state 变迁
$ bpftrace -e '
    kfunc:tcp_set_state
    /args->sk->__sk_common.skc_state != args->state/ {
        printf("%-6d %d -> %d\n", pid,
               args->sk->__sk_common.skc_state, args->state);
    }'

# 🔍 脚本5: 测量 sockops 引入的额外延迟
$ bpftrace -e '
    kfunc:tcp_call_bpf {
        @start[tid] = nsecs;
    }
    kretfunc:tcp_call_bpf /@start[tid]/ {
        $delta = (nsecs - @start[tid]) / 1000;
        if ($delta > 100) {  // > 100us 才打印
            printf("tcp_call_bpf op=%d latency=%dus\n", args->op, $delta);
        }
        delete(@start[tid]);
    }'
```

### 6.4 perf 分析

```bash
# 采样 sockops 相关的内核函数
$ perf record -e 'tcp:tcp_probe' -a -g -- sleep 10
$ perf report

# 查看 BPF 程序自身的指令统计
$ perf stat -e 'bpf:bpf_prog_run' -a -I 1000

# 查看 sockops 路径上的 cache miss
$ perf stat -e 'cache-misses' \
    -e 'kprobes:tcp_call_bpf' \
    -a -- sleep 10
```

---

## 七、生产环境调优清单

| 调优项 | 建议 | 理由 |
|---|---|---|
| **关闭 RTT_CB_FLAG** | 生产环境默认关闭 | 每个 ACK 触发，高频路径不可承受 |
| **PARSE_UNKNOWN 而非 PARSE_ALL** | 解析标志选 UNKNOWN | ALL 使每个收包都进 BPF，UNKNOWN 只在遇到不认识选项时触发 |
| **sockmap 用 BPF_ANY** | 插入标志用 ANY | 避免因 NOEXIST/EXIST 导致的失败重试 |
| **避免在 TCP_CONNECT_CB 中做重操作** | 控制逻辑最简 | 此时 socket 未就绪，`bpf_setsockopt` 等操作可能部分失败 |
| **sockops 程序 < 50 条指令** | 保持精简 | 建连路径上的额外延迟直接增加连接建立时间 |
| **监控 `bpf_sock_ops_cb_flags_set` 的失败** | 记录返回值 | 忽略失败可能导致后续通知回调永不触发 |
| **内核版本 ≥ 5.10** | 最低推荐版本 | 头部选项功能在 5.10 才完全稳定 |
| **每 cgroup 最多 1-2 个 sockops 程序** | 避免链式调用 | 多程序链式执行会增加延迟，且前一个返回 1 会跳过后续程序 |

---

## 八、紧急情况处理

### 8.1 sockops 程序导致连接建立失败

```bash
# 立即从 cgroup 上 detach 程序
$ bpftool cgroup detach /sys/fs/cgroup/unified/ sock_ops id 42

# 确认连接恢复正常
$ curl --connect-timeout 3 http://localhost:8080
```

### 8.2 sockops 程序导致内核 warning/panic

```bash
# 查看内核日志
$ dmesg | tail -50

# 常见 warning 示例:
# "sock_owned_by_me" → TCP 路径未持有 socket 锁（内核 bug，不是你的代码）
# "rcu_read_lock" → 在内核 RCU 读锁外调用了需要 lock 的 BPF helper

# 临时缓解: 重启后不加载该程序
$ systemctl stop bpf-sockops-loader
```

### 8.3 sockmap 中的 socket 数量异常增长

```bash
# 检查 sockmap 元素数量
$ bpftool map show id 10 | grep 'max_entries\|当前'

# 如果接近 max_entries → 增加 max_entries 或检查是否所有 socket 正常关闭
# 统计 sockmap 中的 socket 状态分布
$ bpftool map dump id 10 | wc -l
```

---

> **📝 一句话回顾：** sockops 排障三件套 = bpftool 看 attach 状态 + bpftrace 看触发频率和延迟 + dmesg 看错误码；最常见的"程序没生效"原因是忘了 `return 1` 或在错误的操作码中调用 `bpf_sock_map_update()`。

接下来请阅读 [`self-assessment.md`](./self-assessment.md)，检验你是否真正精通 sockops。
