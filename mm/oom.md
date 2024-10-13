# OOM (Out Of Memory) Killer

参考

- https://github.com/Martins3/Martins3.github.io/blob/master/docs/kernel/mm-oom.md
- https://lwn.net/Kernel/Index/#Memory_management-Out-of-memory_handling
- 🌟[Linux 内存管理 (21)OOM - ArnoldLu - 博客园](https://www.cnblogs.com/arnoldlu/p/8567559.html)
- [linux 内存管理（十四）-内存 OOM 触发分析\_system is deadlocked on memory-CSDN 博客](https://blog.csdn.net/sinat_22338935/article/details/118409427)
- https://blog.csdn.net/sinat_22338935/article/details/118409427
- https://blog.csdn.net/liukuan73/article/details/43238623
- http://blog.chinaunix.net/uid-29634482-id-5127275.html
- http://blog.chinaunix.net/uid-20788636-id-4308527.html

消耗完内存（包括 swap，不包括预留内存）后，发生 OOM，会选择一个用户进程（不包括 init 进程）kill 掉。

## 概览

入口函数 `out_of_memory()`，调用方：

- `__alloc_pages_may_oom()`

  不受 cgroup 管理的用户进程分配内存失败

- `lru_gen_age_node`

  https://lore.kernel.org/linux-mm/20220918080010.2920238-12-yuzhao@google.com/

- `mem_cgroup_out_of_memory`

  用户程序分配内存的时候，经过 cgroup 的检查 `mem_cgroup_charge` 没有通过

- `moom_callback`

  由 `echo f > /proc/sysrq-trigger` 触发

## oom_adj

可以通过调控每个进程的 `/proc/<pid>/oom_adj` 来影响到每个进程的/proc/PID/oom_score，oom_adj 越大，oom_score 分数越高，越容易被干掉

进程被 kill 掉之后，如果 /proc/sys/vm/oom_dump_tasks 为 1，且系统的 rlimit 中设置了 core 文件大小，将会由 /proc/sys/kernel/core_pattern 里面指定的程序生成 core dump 文件，这个文件里将包含 pid, uid, tgid, vm size, rss, nr_ptes, nr_pmds, swapents, oom_score_adj, name 等内容，拿到这个 core 文件之后，可以做一些分析，看为什么这个进程被选中 kill 掉。

## overcommit 策略

可以用 sysctl 修改

- vm.overcommit_memory

  默认值是 0，在这种情况下，只允许轻微的 overcommit，而比较明显的 overcommit 将不被允许。
  如果设置为 1，表示总是允许 overcommit。
  如果设置为 2，则表示总是禁止 overcommit。也就是说，如果某个申请内存的操作将导致 overcommit，那么这个操作将不会得逞。

  详见 `security_vm_enough_memory_mm->__vm_enough_memory()`

- vm.overcommit_kbytes

  详见 `__vm_enough_memory()->vm_commit_limit()`

- vm.overcommit_ratio

  详见 `__vm_enough_memory()->vm_commit_limit()`

控制内存的申请量

## 代码分析

```cpp
out_of_memory()
  /* 通知一些模块，比如让 gpu 或者 virtio-ballon 还回一些内存 */
  if (!is_memcg_oom(oc))
    blocking_notifier_call_chain(&oom_notify_list, 0, &freed);
  /* 如果当前task正要推出，或者将会被kill，则自动选择当前task */
  if (task_will_free_mem(current)) {
    mark_oom_victim(current);
    /* 添加一个定时器，如果当前进程 2s 后还没有退出并释放内存，那该定时器会被触发，
       将 task 放入一个单向链表，唤醒 oom_reaper 内核线程，由 OOM 死神来收取该进程的内存 */
    queue_oom_reaper(current);
    return true;
  }
  /* 选择一个进程 */
  select_bad_process(oc);
  oom_kill_process()->__oom_kill_process()
    do_send_sig_info(SIGKILL) /* 发送 SIGKILL 信号 */
    mark_oom_victim(victim); /* TODO 我只能说这里很关键 */

oom_reaper()
  while (true)
    tsk = oom_reaper_list;
    oom_reaper_list = tsk->oom_reaper_list;
    oom_reap_task()->oom_reap_task_mm()->__oom_reap_task_mm()
      for_each_vma(vmi, vma)
        /* 私有匿名页（比如进程的堆内存）容易释放，不需要额外的步骤 */
        if (vma_is_anonymous(vma) || !(vma->vm_flags & VM_SHARED))
          mmu_notifier_invalidate_range_start_nonblock() /* TODO */
          tlb_gather_mmu()
          /* 完成释放 */
          unmap_page_range()->...->zap_pte_range()->zap_present_ptes()->zap_present_folio_ptes()
            __tlb_remove_folio_pages() /* 把要释放的页面记录在 tlb->active->encoded_pages[] 里 */
          mmu_notifier_invalidate_range_end()
          tlb_finish_mmu() /* TLB invalidate 并释放页面 */
```

`tlb_*()` 的代码分析见 [TLB](tlb.md)。

## 实践

```bash
# 总是允许 overcommit
sysctl -w vm.overcommit_memory=1

# 注意，发生 OOM 的子进程被内核 kill 后会被 stress-ng 再次拉起，要 pkill stress 才能 kill 掉
stress-ng -m 1 --vm-bytes 10G --vm-hang 0 --abort &
```

<details>

<summary>OOM 日志</summary>

```log
[   30.745678] stress-ng-vm invoked oom-killer: gfp_mask=0x440dc0(GFP_KERNEL_ACCOUNT|__GFP_COMP|__GFP_ZERO), order=0, oom_score_adj=1000
[   30.745687] CPU: 1 UID: 0 PID: 116 Comm: stress-ng-vm Not tainted 6.11.0-10669-g11a299a7933e-dirty #15
[   30.745690] Hardware name: QEMU Standard PC (Q35 + ICH9, 2009), BIOS Arch Linux 1.16.3-1-1 04/01/2014
[   30.745691] Call Trace:
[   30.745694]  <TASK>
[   30.745697]  dump_stack_lvl+0x3f/0xb0
[   30.745703]  dump_header+0x48/0x190
[   30.745712]  oom_kill_process+0x255/0x350
[   30.745715]  out_of_memory+0x3cc/0x590
[   30.745717]  __alloc_pages_may_oom+0xf4/0x1b0
[   30.745721]  __alloc_pages_slowpath+0x44e/0x640
[   30.745724]  __alloc_pages_noprof+0x27d/0x330
[   30.745726]  alloc_pages_mpol_noprof+0xa8/0x140
[   30.745729]  pte_alloc_one+0x2f/0xd0
[   30.745732]  __pte_alloc+0x2e/0x170
[   30.745736]  do_pte_missing+0xa5c/0xcb0
[   30.745739]  handle_mm_fault+0x3e9/0x710
[   30.745742]  do_user_addr_fault+0x1f7/0x770
[   30.745744]  ? sched_clock_cpu+0x10/0x190
[   30.745747]  exc_page_fault+0x5c/0xe0
[   30.745750]  asm_exc_page_fault+0x26/0x30
[   30.745754] RIP: 0033:0x56095b546735
[   30.745757] Code: 99 00 41 54 49 89 fa 55 48 89 cd 48 01 fa 53 4c 8b 59 10 4c 39 ca 0f 83 01 01 00 00 31 c9 0f 1f 80 00 00 00 00 89 cf 83 c1 01 <40> 88 3a 48 8b 3d 61 ea 99 00 48 01 fa 4c 39 ca 72 e9 48 89 f0 31
[   30.745759] RSP: 002b:00007fff6c0c9f80 EFLAGS: 00010202
[   30.745761] RAX: 0000000000000010 RBX: 00007f1bc2cb4000 RCX: 00000000079c5301
[   30.745763] RDX: 00007f1da9e00000 RSI: 0000000280000000 RDI: 00000000079c5300
[   30.745764] RBP: 00007f1e43cf23a8 R08: 0000000000000000 R09: 00007f1e42cb4000
[   30.745765] R10: 00007f1bc2cb4000 R11: 0000000000000000 R12: 0000000280000000
[   30.745766] R13: 0000000000000000 R14: 0000000000001000 R15: 00007fff6c0ca0e0
[   30.745768]  </TASK>
[   30.745769] Mem-Info:
[   30.745770] active_anon:1999425 inactive_anon:0 isolated_anon:0
[   30.745770]  active_file:0 inactive_file:0 isolated_file:0
[   30.745770]  unevictable:4653 dirty:0 writeback:0
[   30.745770]  slab_reclaimable:878 slab_unreclaimable:5771
[   30.745770]  mapped:4760 shmem:4157 pagetables:4009
[   30.745770]  sec_pagetables:0 bounce:0
[   30.745770]  kernel_misc_reclaimable:0
[   30.745770]  free:1097 free_pcp:8616 free_cma:0
[   30.745774] Node 0 active_anon:7997700kB inactive_anon:0kB active_file:0kB inactive_file:0kB unevictable:18612kB isolated(anon):0kB isolated(file):0kB mapped:19040kB dirty:0kB writeback:0kB shmem:16628kB writeback_tmp:0kB kernel_stack:2144kB pagetables:16036kB sec_pagetables:0kB all_unreclaimable? no
[   30.745779] Node 0 DMA free:32kB boost:0kB min:20kB low:32kB high:44kB reserved_highatomic:0KB active_anon:14296kB inactive_anon:0kB active_file:0kB inactive_file:0kB unevictable:0kB writepending:0kB present:15992kB managed:15360kB mlocked:0kB bounce:0kB free_pcp:8kB local_pcp:8kB free_cma:0kB
[   30.745783] lowmem_reserve[]: 0 1895 7890 0 0
[   30.745785] Node 0 DMA32 free:3372kB boost:0kB min:2728kB low:4668kB high:6608kB reserved_highatomic:0KB active_anon:1942216kB inactive_anon:0kB active_file:0kB inactive_file:0kB unevictable:0kB writepending:0kB present:2080640kB managed:1964520kB mlocked:0kB bounce:0kB free_pcp:14484kB local_pcp:13260kB free_cma:0kB
[   30.745789] lowmem_reserve[]: 0 0 5994 0 0
[   30.745791] Node 0 Normal free:984kB boost:0kB min:8628kB low:14764kB high:20900kB reserved_highatomic:0KB active_anon:6041180kB inactive_anon:0kB active_file:0kB inactive_file:0kB unevictable:18612kB writepending:0kB present:6291456kB managed:6138744kB mlocked:12kB bounce:0kB free_pcp:19972kB local_pcp:14156kB free_cma:0kB
[   30.745795] lowmem_reserve[]: 0 0 0 0 0
[   30.745796] Node 0 DMA: 0*4kB 0*8kB 0*16kB 1*32kB (M) 0*64kB 0*128kB 0*256kB 0*512kB 0*1024kB 0*2048kB 0*4096kB = 32kB
[   30.745802] Node 0 DMA32: 1*4kB (M) 1*8kB (M) 1*16kB (U) 0*32kB 0*64kB 1*128kB (U) 1*256kB (M) 1*512kB (M) 0*1024kB 1*2048kB (U) 0*4096kB = 2972kB
[   30.745809] Node 0 Normal: 14*4kB (UE) 7*8kB (UE) 3*16kB (U) 3*32kB (UM) 1*64kB (M) 2*128kB (UM) 0*256kB 0*512kB 0*1024kB 0*2048kB 0*4096kB = 576kB
[   30.745817] Node 0 hugepages_total=0 hugepages_free=0 hugepages_surp=0 hugepages_size=1048576kB
[   30.745818] Node 0 hugepages_total=0 hugepages_free=0 hugepages_surp=0 hugepages_size=2048kB
[   30.745819] 8810 total pagecache pages
[   30.745820] 0 pages in swap cache
[   30.745820] Free swap  = 0kB
[   30.745821] Total swap = 0kB
[   30.745822] 2097022 pages RAM
[   30.745822] 0 pages HighMem/MovableOnly
[   30.745823] 67366 pages reserved
[   30.745823] 0 pages cma reserved
[   30.745823] 0 pages hwpoisoned
[   30.745824] Tasks state (memory values in pages):
[   30.745824] [  pid  ]   uid  tgid total_vm      rss rss_anon rss_file rss_shmem pgtables_bytes swapents oom_score_adj name
[   30.745827] [    111]     0   111      431      289       32      257         0    49152        0             0 sh
[   30.745831] [    114]     0   114     7500     4676       96      452      4128    90112        0         -1000 stress-ng
[   30.745834] [    115]     0   115     7501      270       84      186         0    61440        0         -1000 stress-ng-vm
[   30.745836] [    116]     0   116  2628942  1995298  1995157      141         0 16052224        0          1000 stress-ng-vm
[   30.745839] oom-kill:constraint=CONSTRAINT_NONE,nodemask=(null),cpuset=/,mems_allowed=0,global_oom,task_memcg=/,task=stress-ng-vm,pid=116,uid=0
[   30.745847] Out of memory: Killed process 116 (stress-ng-vm) total-vm:10515768kB, anon-rss:7980628kB, file-rss:564kB, shmem-rss:0kB, UID:0 pgtables:15676kB oom_score_adj:1000
```

</details>
