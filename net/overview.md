---
description: 本文是对Linux内核网络协议栈的一些总结，写的有点乱，将来再整理一下
---

# 参考资料

- [十年码农内功：网络收包详细过程（一） - 知乎](https://zhuanlan.zhihu.com/p/643195830)
- [十年码农内功：网络收包详细过程（二） - 知乎](https://zhuanlan.zhihu.com/p/643199019)
- [十年码农内功：网络收包详细过程（三） - 知乎](https://zhuanlan.zhihu.com/p/643201113)
- [十年码农内功：网络收包详细过程（四） - 知乎](https://zhuanlan.zhihu.com/p/643202833)
- [十年码农内功：网络发包详细过程 - 知乎](https://zhuanlan.zhihu.com/p/645347804)
- [监控和调优 Linux 网络栈：接收数据 - 知乎](https://zhuanlan.zhihu.com/p/682274203)
- [Linux 网络栈原理、监控与调优：前言（2022）](https://arthurchiao.art/blog/linux-net-stack-zh/)
  - Linux 网络栈原理、监控与调优：前言
  - Linux 中断（IRQ/softirq）基础：原理及内核实现
  - Linux 网络栈接收数据（RX）：原理及内核实现
  - Monitoring Linux Network Stack
  - Linux 网络栈接收数据（RX）：配置调优
- [Linux 网络协议栈收消息过程-TCP Protocol Layer | A Blog](https://ylgrgyq.github.io/2017/08/01/linux-receive-packet-3/)
- freelancer-leon_notes/kernel/networking/monitoring-tuning-linux-networking-stack-receiving-data.md

# 初始化

初始化，可以分为几部分

1. 软中断进程初始化（ksoftirqd）
   `early_initcall(spawn_ksoftirqd);`
2. 网络子系统
   `subsys_initcall(net_dev_init);`
   1. 注册软中断处理函数
3. TCP/IP 协议栈，传输层和网络层
   net/ipv4/af_inet.c
   `fs_initcall(inet_init);`
   ipv4 tcp udp icmp

   ip_rcv

   udp_rcv
   tcp_rcv_v4

   `struct proto`
   `struct proto_ops`
   `struct net_protocol`
   `struct net_proto_family`

4. 邻居子系统

   `subsys_initcall(neigh_init);`

5. 网卡驱动
   分配队列、注册中断处理函数
   ethtool
   net_device_ops
   netdev

## ksoftirqd

创建 per-cpu 的内核线程，线程名 `ksoftirqd/%u`

```cpp
early_initcall(spawn_ksoftirqd);

// 这个 kernel_init 是 1 号进程的入口函数，用户进程，此时还未到用户态去执行 /sbin/init
kernel_init->kernel_init_freeable->do_pre_smp_initcalls
  for (fn = __initcall_start; fn < __initcall0_start; fn++)
    do_one_initcall->fn:spawn_ksoftirqd
      smpboot_register_percpu_thread
        for_each_online_cpu(cpu)
          __smpboot_create_thread
```

ksoftirqd 线程执行：

```cpp
// kthread 是一个内核线程的入口
kthread->threadfn:smpboot_thread_fn()
  if(!thread_should_run:ksoftirqd_should_run())
    schedule();
  else
    thread_fn:run_ksoftirqd();
      if (local_softirq_pending())
        __do_softirq();
```

一个重要知识点：执行硬中断的处理函数的 CPU 核心，也会执行该硬中断后续的软中断处理函数，也就是同一中断事件的软/硬中断处理函数会被同一个 CPU 核心执行。

## 网络子系统

```cpp
subsys_initcall(net_dev_init);

net_dev_init
  // register a network namespace subsystem
  // 当创建一个 network namespace 时，就会调用 ops 里的 netdev_init 进行初始化。
  // LIST_HEAD(net_namespace_list); 是一个 struct net 链表
  register_pernet_subsys(&netdev_net_ops)
  // 初始化 per-cpu 的 struct softnet_data
  for_each_possible_cpu(i)
    INIT_WORK(flush, flush_backlog);
    skb_queue_head_init(&sd->input_pkt_queue);
    skb_queue_head_init(&sd->process_queue);
    // per-cpu 的 struct napi_struct 链表
    INIT_LIST_HEAD(&sd->poll_list);
    // per-cpu 的 struct napi_struct backlog
    sd->backlog.poll = process_backlog;
    ...
  // register a network namespace device
  // 每个 network namespace 都会有一个 lo 网卡
  register_pernet_device(&loopback_net_ops)
  register_pernet_device(&default_device_ops)
  // 注册软中断处理函数
  open_softirq(NET_TX_SOFTIRQ, net_tx_action);
  open_softirq(NET_RX_SOFTIRQ, net_rx_action);
```

## 邻居子系统

- [linux_neighbor | 追光者](https://xdksx.github.io/2021/05/22/linux-neighbor/)
- [图解 linux netlink](https://jgsun.github.io/2018/12/14/linux-netlink/)

```cpp
subsys_initcall(neigh_init);

neigh_init
  // Register a rtnetlink message type
  rtnl_register(PF_UNSPEC, RTM_NEWNEIGH, neigh_add, NULL, 0);
  rtnl_register(PF_UNSPEC, RTM_DELNEIGH, neigh_delete, NULL, 0);
  rtnl_register(PF_UNSPEC, RTM_GETNEIGH, neigh_get, neigh_dump_info, 0);
  rtnl_register(PF_UNSPEC, RTM_GETNEIGHTBL, NULL, neightbl_dump_info, 0);
  rtnl_register(PF_UNSPEC, RTM_SETNEIGHTBL, neightbl_set, NULL, 0);
```

XXX 暂时不细看，

## 协议栈（传输层和网络层）

1. ptype_base 哈希表，key 是 include/uapi/linux/if_ether.h 里定义的 Ethernet Protocol ID，即以太网帧里的[以太类型](https://zh.wikipedia.org/wiki/%E4%BB%A5%E5%A4%AA%E7%B1%BB%E5%9E%8B)，value 则是对应的网络层接收函数，对于 IPV4 则是 ip_rcv
2. inet_protos 数组。数组索引是 IPV4 头部的[IP 协议号列表 - 维基百科，自由的百科全书](https://zh.wikipedia.org/wiki/IP%E5%8D%8F%E8%AE%AE%E5%8F%B7%E5%88%97%E8%A1%A8)，value 则是对应的传输层接收函数。（虽然 icmp 并不是传输层。。）

```cpp
fs_initcall(inet_init);

inet_init
  // 放进 proto_list（查看 /proc/net/protocols 会用到这个链表）
  // 另外，会分配 slab cache
  proto_register(&tcp_prot, 1);
  proto_register(&udp_prot, 1);
  proto_register(&raw_prot, 1);
  proto_register(&ping_prot, 1);

  // 创建 socket(AF_INET,,) 会用到的 ops
  sock_register(&inet_family_ops);

  // 放进 struct net_protocol inet_protos[MAX_INET_PROTOS] 数组
  // 是传输层提供给网络层的接口，通过这个接口，从网络层进入传输层
  inet_add_protocol(&icmp_protocol, IPPROTO_ICMP)
  inet_add_protocol(&udp_protocol, IPPROTO_UDP)
  inet_add_protocol(&tcp_protocol, IPPROTO_TCP)
  inet_add_protocol(&igmp_protocol, IPPROTO_IGMP)

  // 提供给 socket 层的接口
  // 是一些回调 connect recvmsg sendmsg。
  // 总共 4 个协议。
  // socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
  // socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
  // socket(AF_INET, SOCK_RAW, IPPROTO_IP)
  // socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)
  for (q = inetsw_array; q < &inetsw_array[INETSW_ARRAY_LEN]; ++q)
    inet_register_protosw(q);

  // 将协议处理函数，注册进 ptype_base 哈希表
  dev_add_pack(&ip_packet_type);


// TODO struct proto 和 struct proto_ops 的区别？

struct proto {

}
struct proto_ops {

}


struct tcp_sock {

}

struct udp_sock {

}
```

```bash
# 查看支持的报文
$ cat /proc/net/ptype
Type Device      Function
0800          ip_rcv
0806          arp_rcv
00fa          mctp_pkttype_receive
86dd          ipv6_rcv

# 查看支持的协议，是通过 proto_register 注册的
$ cat /proc/net/protocols
```

## 网卡驱动

### 驱动加载

weight 代表 RX 队列的处理权重，budget 表示一种惩罚措施，用于多 CPU 多队列之间的公平性调度

```cpp
virtnet_probe
  //
  //
  init_vqs
    virtnet_alloc_queues
      for (i = 0; i < vi->max_queue_pairs; i++)
        // 这两个函数，都会注册 poll 回调到 struct napi_struct 里。
        // virtnet_poll 用于收包
        // virtnet_poll_tx 用于发完包后释放 skb
        netif_napi_add_weight(vi->dev, &vi->rq[i].napi, virtnet_poll, napi_weight);
        netif_napi_add_tx_weight(vi->dev, &vi->sq[i].napi, virtnet_poll_tx, napi_tx ? napi_weight : 0);
    virtnet_find_vqs
      for (i = 0; i < vi->max_queue_pairs; i++)
        // 中断处理函数会调用这个 callback
        // 这两个 callback 都会调用 __napi_schedule
        callbacks[rxq2vq(i)] = skb_recv_done;
        callbacks[txq2vq(i)] = skb_xmit_done;
      // 分配 virtqueue、申请 MSI-X 中断向量、注册中断处理函数 vring_interrupt
      virtio_find_vqs_ctx(vi->vdev, total_vqs, vqs, callbacks, names, ctx, NULL);
```

[NAPI — The Linux Kernel documentation](https://docs.kernel.org/networking/napi.html)
什么是 napi? 是在网卡驱动这一层吧。

```cpp
// net/core/dev.c

// API
netif_napi_add
netif_napi_add_tx
```

这两个函数都会调用到 netif_napi_add_weight，区别是，后者会将 napi->state 加上 NAPI_STATE_NO_BUSY_POLL bit，表明不需要 busy polling。也就是不会通过 napi_hash_add 函数将 struct napi_struct 放入 napi_hash 哈希表。

sk_busy_loop->napi_busy_loop 会从 napi_hash 哈希表中取出 struct napi_struct 进行轮询，

`____napi_schedule` 会把 struct napi_struct 挂在 per-cpu 的 struct softnet_data 的 poll_list 链表上。并设置 `NET_RX_SOFTIRQ` 的 pending 位。

net_rx_action 会调用 virtnet_poll 和 virtnet_poll_tx。
后面会讲为什么 `NET_RX_SOFTIRQ` 的调用次数为什么比 `NET_TX_SOFTIRQ` 高得多

### 启用网卡设备

ifconfig ethO up

net_device_ops 中的 ndo_open 方法会被调用。

```cpp
entry_SYSCALL_64->do_syscall_64->do_syscall_x64->__x64_sys_ioctl->__se_sys_ioctl
  // 对任意一个 socket fd 进行 ioctl SIOCSIFFLAGS IFF_UP
  // https://man7.org/linux/man-pages/man7/netdevice.7.html
  __do_sys_ioctl->vfs_ioctl->sock_ioctl->sock_do_ioctl->inet_ioctl->devinet_ioctl
    dev_change_flags->__dev_change_flags->__dev_open->ndo_open:virtnet_open()
      for (i = 0; i < vi->max_queue_pairs; i++)
        // 准备 Receive Queue
        try_fill_recv()
        virtnet_enable_queue_pair()
          // 启用两个 struct napi_struct
          virtnet_napi_enable()
          virtnet_napi_tx_enable()


____napi_schedule(struct softnet_data * sd, struct napi_struct * napi) (\root\code\opensource\linux\net\core\dev.c:4446)
__napi_schedule(struct napi_struct * n) (\root\code\opensource\linux\net\core\dev.c:6020)
virtqueue_napi_schedule(struct virtqueue * vq) (\root\code\opensource\linux\drivers\net\virtio_net.c:457)
virtnet_napi_enable(struct virtqueue * vq, struct napi_struct * napi) (\root\code\opensource\linux\drivers\net\virtio_net.c:2054)
```

NAPI 的核心概念是不采用频繁硬中断的方式读取数据，而是首先采用硬中断唤醒 NAPI 子系统，然后触发软中断，网络子系统处理软中断，然后循环调用 poll_list 中的 NAPI 实例的 poll 函数来循环接收数据包，这样可以防止高频硬中断影响系统的运行效率。当然，NAPI 也有缺陷，系统不能及时接收每一个包，而是多个包一起处理，进而增加了部分数据包的延时。

## 一些知识点

`__do_softirq` 的调用点

1. ksoftirqd 线程 `run_ksoftirqd`
2. 中断退出时
   `common_interrupt->__irq_exit_rcu->invoke_softirq->__do_softirq`
   注意，在 force irq threading（比如因为 CONFIG_PREEMPT_RT）并且已经创建 ksoftirqd 线程时，`invoke_softirq` 里不会调用 `__do_softirq`，而是会 `wakeup_softirqd()`。
   [这是为了方便 debug 强制让 softirq 在 ksoftirqd 里处理](https://lore.kernel.org/lkml/20110223234956.772668648@linutronix.de/)，我还以为是为了实时性呢。。
   问题：这样反而会影响实时性吗？比如没有执行 TIMER_SOFTIRQ，导致一个高优先级的线程没有被唤醒？唤醒的动作是在 hardirq 还是 softirq？
3. 在 `local_bh_enable` 时，如果检查到了 pending，则进行处理。

# 收包流程

## L1

1. 网卡收到数据包，DMA 方式写入 virtqueue (Ring Buffer)，发出 MSI-X 中断
2. 内核执行中断处理函数，NAPI 加入本 CPU 的轮询列表，发出软中断；
3. 内核收到软中断，轮询 NAPI 并执行 poll 函数从 Ring Buffer 取数据；
4. GRO 操作（默认开启），合并多个数据包为一个数据包，如果 RPS 关闭，则把数据包递交到协议栈；
5. RPS 操作（默认关闭），如果开启，使数据包通过别的（也可能是当前的） CPU 递交到协议栈；

```cpp
// 中断处理函数：会置 NET_RX_SOFTIRQ 的 pending 位
common_interrupt->__common_interrupt->handle_irq->generic_handle_irq_desc
  handle_edge_irq->handle_irq_event->handle_irq_event_percpu->__handle_irq_event_percpu
    vp_vring_interrupt->vring_interrupt->callback:skb_recv_done->virtqueue_napi_schedule(&rq->napi)
      __napi_schedule->____napi_schedule(this_cpu_ptr(&softnet_data),)
        // 将该 napi_struct 放进当前 cpu 的 struct softnet_data 的链表里
        list_add_tail(&napi->poll_list, &sd->poll_list);
        // 置 NET_RX_SOFTIRQ 的 pending 位
        __raise_softirq_irqoff(NET_RX_SOFTIRQ);


// __do_softirq 的代码逻辑：
ret_from_fork_asm->ret_from_fork->kthread->smpboot_thread_fn->run_ksoftirqd
  // 调用 __do_softirq 之前必须禁止 local irq
  ksoftirqd_run_begin->local_irq_disable
  __do_softirq
    pending = local_softirq_pending();
    // 从 task context 进入 softirq context
    softirq_handle_begin->__local_bh_disable_ip(_RET_IP_, SOFTIRQ_OFFSET);
    // softirq pending bitmask 清零
    set_softirq_pending(0);

    // 处理 softirq 时，是开本地中断的
    local_irq_enable();
    // 按优先级处理 softirq
    while ((softirq_bit = ffs(pending)))
      // net_rx_action
      h->action(h);
      pending >>= softirq_bit;
    // 关中断
    local_irq_disable();

    // 如果在执行 softirq 的过程中，又来了新的
    pending = local_softirq_pending();
    if (pending)
      // 如果没超时，则返回到前面继续处理 softirq
      if (time_before(jiffies, end) && !need_resched() && --max_restart)
        goto restart;
      // 否则，唤醒 ksoftirqd 线程
      wakeup_softirqd();

    // 从 softirq context 返回到 task context
    softirq_handle_end->__local_bh_enable(SOFTIRQ_OFFSET);
  ksoftirqd_run_end->local_irq_enable


// net_rx_action 的逻辑
// 注意此时是开中断的状态
net_rx_action
  // 注意，这里访问 per-cpu 变量时，没有关中断，因为这不是在 task context，所以没问题
  struct softnet_data *sd = this_cpu_ptr(&softnet_data);
  // 控制消费 rx_buffer 的数量，避免 CPU 一直被软中断占用。
  int budget = READ_ONCE(netdev_budget);
  local_irq_disable();
  // 和 hardirq context 的 ____napi_schedule 存在竞争，所以要关中断保护
  list_splice_init(&sd->poll_list, &list);
  local_irq_enable();
  // budget <= 0 或者链表为空，就退出
  for (;;)
    skb_defer_free_flush(sd);
    // 得到链表的第一个 struct napi_struct
    struct napi_struct *n = list_first_entry(&list, struct napi_struct, poll_list);
    // 开始 poll。传入一个 repoll 链表，需要重新 poll 的会放进这个链表
    budget -= napi_poll(n, &repoll);
      // 将该 struct napi_struct 从链表里移除
      list_del_init(&n->poll_list);
      // poll 这个 napi_struct
      work = __napi_poll(n, &do_repoll);
        if (napi_is_scheduled(n))
          // virtnet_poll
          n->poll(n, weight);
  /* 通过 smp_call_function_single_async 远程激活 sd->rps_ipi_list 中的其他 CPU 的软中断，
   * 使其他 CPU 执行初始化时注册的软中断函数 csd = rps_trigger_softirq 来处理数据包 */
  net_rps_action_and_irq_enable(sd);


// virtio-net 驱动注册的 napi_struct 里的 poll 函数
// 最后，会
virtnet_poll
  virtnet_receive->receive_buf
    // 获取以太网头部的 Ethernet Protocol ID
    // TODO 为什么放在网卡驱动这一层来做这个事情？我看其他网卡也是这样
    skb->protocol = eth_type_trans(skb, dev);
    //
    napi_gro_receive
      // 完成多个数据包的合并
      dev_gro_receive->inet_gro_receive
        // 根据包类型 TCP/UDP 分别判断数据包的完整性和判断需不需要合并
        tcp4_gro_receive->tcp_gro_receive
      // 继续处理
      napi_skb_finish->gro_normal_one
        // 放进 napi_struct 的 rx_list 链表
        list_add_tail(&skb->list, &napi->rx_list);
        // 如果链表满了 8 个（通过 sysctl net.core.gro_normal_batch 查看），就送往协议栈
        gro_normal_list->netif_receive_skb_list_internal
  virtqueue_napi_complete
    napi_complete_done
```

budget 表示一种惩罚措施，用于多 CPU 多队列之间的公平性调度

budget 的大小会影响到 CPU 的利用率，当数据包特别多的情况下，budget 越大可以减少数据包的延时，但是会影响 CPU 处理其他任务。budget 默认 300，可以调整使用下面命令修改：

`$ sysctl -w net.core.netdev_budget=500`

前面收包过程都是内核跟网卡硬件和驱动配合来完成的，也就是说不同网卡收包的具体实现可能不同（同一家厂商的网卡的实现基本相同），但是大体实现思路上是一样的，都是用到了 Ring Buffer、DMA、硬中断和软中断等操作。

后面就是由内核和用户程序来完成了，与网卡没有关系了。

**GRO**（Generic Receive Offloading）是 LGO（Large Receive Offload，多数是在 NIC 上实现的一种硬件优化机制）的一种软件实现，从而能让所有 NIC 都支持这个功能。网络上大部分 MTU 都是 1500 字节，开启 Jumbo Frame 后能到 9000 字节，如果发送的数据超过 MTU 就需要切割成多个数据包。通过合并「足够类似」的包来减少传送给网络协议栈的包数，有助于减少 CPU 的使用量。GRO 使协议层只需处理一个 header，而将包含大量数据的整个大包送到用户程序。如果用 tcpdump 抓包看到机器收到了不现实的、非常大的包，这很可能是系统开启了 GRO。

GRO 和硬中断合并的思想类似，不过阶段不同。硬中断合并是在中断发起之前，而 GRO 已经在软中断处理中了。

```bash
# 查看 GRO 是否开启
$ ethtool -k eth0 | grep generic-receive-offload
generic-receive-offload: on
# 开启 GRO
$ ethtool -K eth0 gro on
```

**RPS**（Receive Packet Steering）是 RSS 的一种软件实现。

- 因为是软件实现的，所以任何网卡都可以使用 RPS，单队列和多队列网卡都可以使用；
- RPS 在数据包从 Ring Buffer 中取出来后开始工作，将 Packet hash 到对应 CPU 的 backlog 中，并触发 IPI（Inter-processorInterrupt，进程间中断）告知目标 CPU 来处理 backlog。该 Packet 将被目标 CPU 交到协议栈。从而实现将负载分散到多个 CPU 的目的；
- 单队列网卡使用 RPS 可以提升传输效率，多队列网卡在硬中断不均匀时同样可以使用来提升效率；

## L2

```cpp
netif_receive_skb_list_internal
  if (static_branch_unlikely(&rps_needed))
    enqueue_to_backlog(skb, cpu, &rflow->last_qtail);
  __netif_receive_skb_list->__netif_receive_skb_list_core
    // L2 层的核心逻辑。要么转发，要么就
    __netif_receive_skb_core(&skb, pfmemalloc, &pt_prev)
      // 这个 rx_handler 默认是 NULL，可以通过 netdev_rx_handler_register 来修改。
      // 比如 net/bridge/br_if.c 的 br_add_if 会将其注册为 br_handle_frame
      if (rx_handler)
        rx_handler(&skb);
      // skb->protocol 是 16bit 的 Ethernet Protocol ID
      // IP协议是 0x0800 (00001000 00000000)，由于是大端序，因此调试时看到的是 0x8 (00000000 00001000)
      type = skb->protocol;
      // 根据这个协议 ID，在 ptype_base 哈希表里找到 struct packet_type ip_packet_type
      // XXX 不知道为什么没调用到 deliver_skb
      deliver_ptype_list_skb(skb, &pt_prev,,type, &ptype_base[ntohs(type) & PTYPE_HASH_MASK]);
      if (pt_prev)
        *ppt_prev = pt_prev;
    if (!pt_prev)
      continue;
    if (pt_curr != pt_prev || od_curr != orig_dev)
      pt_curr = pt_prev;
    // 知道协议类型了，送往 L3
    __netif_receive_skb_list_ptype(, pt_curr=ip_packet_type,)
      // struct packet_type 的 list_func，是通过 dev_add_pack 注册的
      list_func:ip_rcv()/ip_list_rcv()


网卡驱动还可以直接调用
netif_receive_skb->netif_receive_skb_internal->__netif_receive_skb
  __netif_receive_skb_one_core
    // 最后都差不多一样
    __netif_receive_skb_core
    if (pt_prev)
      ret = INDIRECT_CALL_INET(pt_prev->func, ipv6_rcv, ip_rcv, skb, skb->dev, pt_prev, orig_dev);
```

### dev_add_pack

- 🌟[用户态 tcpdump 如何实现抓到内核网络包的?](https://mp.weixin.qq.com/s/ZX8Jluh-RgJXcVh3OvycRQ)
- [一文了解 Linux 内核角度分析 tcpdump 原理 - 知乎](https://zhuanlan.zhihu.com/p/483904538)
- [Linux 网络报文捕获/抓包技术对比：napi、libpcap、afpacket、PF_RING、PACKET_MMAP、DPDK、XDP(eXpress Data Path)\_ebpf 抓包-CSDN 博客](https://blog.csdn.net/armlinuxww/article/details/111930788)
- [网络数据包收发流程(四)：协议栈之 packet_type - CasonChan - 博客园](https://www.cnblogs.com/CasonChan/p/5166250.html)
  tcpdump 也是在二层抓包的，用的是 libpcap 库，它的基本原理是
  1. 先创建 socket，内核 dev_add_packet()挂上自己的钩子函数
  2. 然后在钩子函数中，把 skb 放到自己的接收队列中，
  3. 接着系统调用 recv 取出 skb 来，把数据包 skb->data 拷贝到用户空间

TODO 和 https://zhuanlan.zhihu.com/p/643199019的不太一样，我在 deliver_skb 打的断点没命中过。

在 deliver_ptype_list_skb 函数里，ptype_list 里可能有很多个 ptype 的 type 都和当前 skb 的 type 对的上，因此每次循环都用 pt_prev 保存上一轮循环里匹配的 ptype，如果这次循环匹配到了，会调用 deliver_skb 把 skb 递送到上一次匹配到的 ptype。
这是干什么？没看懂？？
deliver_skb 会 refcount_inc(&skb->users);

由于 `dev_add_pack` 是把协议处理函数注册到哈希表里的链表头，因此注册顺序越往后的，在上面就越早 deliver_skb。
而最先注册的那一个，则是在 `__netif_receive_skb_list_ptype` 里进行处理

dev_add_pack 的调用点：

1. net/ipv4/af_inet.c inet_init->dev_add_pack(&ip_packet_type);
2. net/packet/af_packet.c 用于抓包？？已经被废弃
   - socket 的 bind 操作 packet_bind->packet_do_bind->register_prot_hook
   - `packet_create->__register_prot_hook->dev_add_pack`

## L3

```cpp
ip_list_rcv->ip_sublist_rcv
  NF_HOOK_LIST(NFPROTO_IPV4, NF_INET_PRE_ROUTING, net, NULL, head, dev, NULL, ip_rcv_finish);
  ip_list_rcv_finish
    // L3 层的核心逻辑，路由选择
    ip_rcv_finish_core
      // net/ipv4/route.c 路由。最终会设置一个 input 回调，是 ip_local_deliver 或者 ip_forward 或者其他的
      ip_route_input_noref->ip_route_input_rcu->ip_route_input_slow
        // 查找路由表，结果保存在 res 里
        fib_lookup(net, &fl4, res, 0);
        // 会根据 res->type 来判断
        if (res->type == RTN_LOCAL)
          goto local_input; // 为了方便，我直接写在下一行。。
          rt_dst_alloc(, flags | RTCF_LOCAL,,);
            if (flags & RTCF_LOCAL)
              // 设置 input 回调
              rt->dst.input = ip_local_deliver;
        // 最后，res->type 等于 RTN_UNICAST，也就是转发
        ip_mkroute_input->__mkroute_input
          // 设置 input 回调
          rth->dst.input = ip_forward;
    // 根据路由结果，
    ip_sublist_rcv_finish->dst_input
      // 调用 skb_dst(skb)->input 回调。
      // 送往下一层（传输层）
      ip_local_deliver
        NF_HOOK(NFPROTO_IPV4, NF_INET_LOCAL_IN, net, NULL, skb, skb->dev, NULL, ip_local_deliver_finish);
          ip_local_deliver_finish->ip_protocol_deliver_rcu
            tcp_v4_rcv()或udp_rcv()或其他的
      // 转发
      ip_forward
        NF_HOOK(NFPROTO_IPV4, NF_INET_FORWARD, net, NULL, skb, skb->dev, rt->dst.dev, ip_forward_finish);
      // 或者其他的。。比如 multicast
```

```bash
$ ip route list table local
...
local 192.168.0.3 dev eth0 proto kernel scope host src 192.168.0.3
local 127.0.0.0/8 dev lo proto kernel scope host src 127.0.0.1

# 抓包。如果换成 eth0 设备，则没反应
$ tcpdump -i lo port 12345
#
$ telnet 192.168.0.3 12345
```

对本机的 127.0.0.1 网络请求，根据路由表，设备全部使用 lo 网卡。
对于 192.168.0.3，根据路由表，是被路由到 eth0，但是！实际上并不会，实际上仍是 lo 虚拟网卡。

## L4

```cpp
udp_rcv

udp_queue_rcv_skb
  // 将数据包放入套接字的接收队列中
  udp_queue_rcv_one_skb
    __udp_queue_rcv_skb
      __udp_enqueue_schedule_skb
        __skb_queue_tail
          // 如果套接字不是关闭状态。
          if (!sock_flag(sk, SOCK_DEAD))
            // 通知套接字数据准备就绪。
            sk->sk_data_ready(sk);

sock_def_readable
    // 读取 sk->sk_wq 字段的值，即 struct sock 结构体中的 sk_wq 成员。它是在 RCU 临界区内执行的。
    wq = rcu_dereference(sk->sk_wq);
    // 检查 wq 所指向的 struct socket_wq 是否有等待唤醒的进程。
    if (skwq_has_sleeper(wq))
        // 如果有等待唤醒的进程，那么 wake_up_interruptible_sync_poll 函数会触发对等待队列中的进程的唤醒，并传递相应的事件掩码，其中 EPOLLIN、EPOLLPRI、EPOLLRDNORM、EPOLLRDBAND 是用于表示可读事件的标志。
        wake_up_interruptible_sync_poll(&wq->wait, EPOLLIN | EPOLLPRI | EPOLLRDNORM | EPOLLRDBAND);
    // 异步唤醒与给定套接字关联的进程。SOCK_WAKE_WAITD 是指定唤醒类型的标志，表示等待可读事件。POLL_IN 是传递给唤醒函数的事件掩码，表示可读事件。
    sk_wake_async(sk, SOCK_WAKE_WAITD, POLL_IN);
    rcu_read_unlock();
```

- [Linux TCP 数据包接收处理 tcp_rcv_established - kk Blog —— 通用基础](https://abcdxyzk.github.io/blog/2015/04/01/kernel-net-estab/)

```cpp
tcp_v4_rcv
  tcp_v4_do_rcv
    tcp_rcv_established
      /* step 7: process the segment text */
      tcp_data_queue
        // 接收数据到队列中
        tcp_queue_rcv
          __skb_queue_tail
        // 唤醒 socket 上阻塞的线程
        tcp_data_ready
          // sock_def_readable
          sk->sk_data_ready(sk)
```

## socket

```cpp
// udp
__sys_recvfrom
  inet_recvmsg
    udp_recvmsg
      __skb_recv_udp
        __skb_try_recv_from_queue
        __skb_wait_for_more_packets
          schedule_timeout

// tcp
```

# 发包

neigh_output

hardware header cache?
struct hh_cache
