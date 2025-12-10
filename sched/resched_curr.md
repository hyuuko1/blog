```bash
sudo bpftrace -e 'fentry:vmlinux:__resched_curr { @[kstack] = count(); }'

@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        update_curr+248
        task_tick_fair+70
        sched_tick+168
        update_process_times+164
        tick_nohz_handler+143
        __hrtimer_run_queues+304
        hrtimer_interrupt+252
        __sysvec_apic_timer_interrupt+85
        sysvec_apic_timer_interrupt+56
        asm_sysvec_apic_timer_interrupt+26
]: 5

...

@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        active_load_balance_cpu_stop+559
        cpu_stopper_thread+155
        smpboot_thread_fn+240
        kthread+249
        ret_from_fork+449
        ret_from_fork_asm+26
]: 441
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        try_to_wake_up+646
        hrtimer_wakeup+34
        __hrtimer_run_queues+304
        hrtimer_interrupt+252
        __sysvec_apic_timer_interrupt+85
        sysvec_apic_timer_interrupt+108
        asm_sysvec_apic_timer_interrupt+26
        cpuidle_enter_state+187
        cpuidle_enter+49
        do_idle+433
        cpu_startup_entry+41
        rest_init+204
        start_kernel+2466
        x86_64_start_reservations+36
        x86_64_start_kernel+209
        common_startup_64+318
]: 626


# 这里走的是 ttwu_queue()->ttwu_do_activate()->wakeup_preempt()
# 说明 ttwu_queue_cond() 返回 false 了，可能是因为 task 要运行在当前 cpu 上或其他原因。
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        try_to_wake_up+646
        __handle_irq_event_percpu+159
        handle_irq_event+56
        handle_edge_irq+197
        __common_interrupt+62
        common_interrupt+128
        asm_common_interrupt+38
        cpuidle_enter_state+187
        cpuidle_enter+49
        do_idle+433
        cpu_startup_entry+41
        start_secondary+281
        common_startup_64+318
]: 996
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        sched_ttwu_pending+219
        __flush_smp_call_function_queue+347
        __sysvec_call_function_single+28
        sysvec_call_function_single+108
        asm_sysvec_call_function_single+26
        cpuidle_enter_state+187
        cpuidle_enter+49
        do_idle+433
        cpu_startup_entry+41
        rest_init+204
        start_kernel+2466
        x86_64_start_reservations+36
        x86_64_start_kernel+209
        common_startup_64+318
]: 2618
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        sched_ttwu_pending+219
        __flush_smp_call_function_queue+347
        flush_smp_call_function_queue+55
        do_idle+328
        cpu_startup_entry+41
        start_secondary+281
        common_startup_64+318
]: 3124
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        try_to_wake_up+646
        hrtimer_wakeup+34
        __hrtimer_run_queues+304
        hrtimer_interrupt+252
        __sysvec_apic_timer_interrupt+85
        sysvec_apic_timer_interrupt+108
        asm_sysvec_apic_timer_interrupt+26
        cpuidle_enter_state+187
        cpuidle_enter+49
        do_idle+433
        cpu_startup_entry+41
        start_secondary+281
        common_startup_64+318
]: 4788
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+351
        bpf_trampoline_6442509520+71
        __resched_curr+5
        wakeup_preempt+76
        ttwu_do_activate+136
        sched_ttwu_pending+219
        __flush_smp_call_function_queue+347
        __sysvec_call_function_single+28
        sysvec_call_function_single+108
        asm_sysvec_call_function_single+26
        cpuidle_enter_state+187
        cpuidle_enter+49
        do_idle+433
        cpu_startup_entry+41
        start_secondary+281
        common_startup_64+318
]: 28357
```

最多的是 CALL_FUNCTION_SINGLE_VECTOR 这个 IPI 中断，其次是 timer

```cpp
arch_send_call_function_single_ipi()...->native_send_call_func_single_ipi()
```

来看哪些地方会发这个 IPI 中断，

```bash
❯ sudo bpftrace -e 'fentry:vmlinux:native_send_call_func_single_ipi  { @[kstack] = count(); }'

@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        generic_exec_single+54
        smp_call_function_single_async+34
        update_process_times+164
        tick_nohz_handler+143
        __hrtimer_run_queues+304
        hrtimer_interrupt+252
        __sysvec_apic_timer_interrupt+85
        sysvec_apic_timer_interrupt+56
        asm_sysvec_apic_timer_interrupt+26
]: 1009
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        pollwake+119
        __wake_up_common+111
        eventfd_write+195
        vfs_write+203
        ksys_write+115
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 1106
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        ep_autoremove_wake_function+22
        __wake_up_common+111
        __wake_up_sync+60
        ep_poll_callback+285
        __wake_up_common+111
        __wake_up_sync_key+67
        sock_def_readable+66
        unix_stream_sendmsg+693
        sock_write_iter+398
        do_iter_readv_writev+350
        vfs_writev+360
        do_writev+230
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 1255
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        pollwake+119
        __wake_up_common+111
        __wake_up_sync_key+67
        sock_def_readable+66
        unix_stream_sendmsg+693
        sock_write_iter+398
        do_iter_readv_writev+350
        vfs_writev+360
        do_writev+230
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 2046
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        pollwake+119
        __wake_up_common+111
        __wake_up_sync_key+67
        anon_pipe_write+675
        vfs_write+961
        ksys_write+191
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 3537
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        ep_autoremove_wake_function+22
        __wake_up_common+111
        __wake_up_sync+60
        ep_poll_callback+285
        __wake_up_common+111
        __wake_up_sync_key+67
        sock_def_readable+66
        unix_stream_sendmsg+693
        __sys_sendto+498
        __x64_sys_sendto+36
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 5828
@[
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_prog_6deef7357e7b4530_sd_fw_ingress+343
        bpf_trampoline_6442560292+67
        native_send_call_func_single_ipi+9
        ttwu_queue_wakelist+254
        try_to_wake_up+545
        wake_up_q+55
        futex_wake+394
        do_futex+287
        __x64_sys_futex+301
        do_syscall_64+129
        entry_SYSCALL_64_after_hwframe+118
]: 9357
```

ttwu_queue()

ttwu_queue_wakelist() 里要满足 ttwu_queue_cond() 条件才行。
需要但那个 cpu 与当前 cpu 不 share cahce 或者是 idle 时，就会发 IPI 中断？

ttwu_queue_wakelist() 的作用是什么？
将一个刚刚被唤醒的进程（Task）真正地推入到目标 CPU 的 运行队列（Runqueue, rq） 中，或者将其加入到一个等待队列中通过 IPI（核间中断）异步处理。
