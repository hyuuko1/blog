# kdump & crash

- [Kdump - ArchWiki](https://wiki.archlinux.org/title/Kdump)
- [3.3.2 内核态调测工具：kdump&crash——kdump - 知乎](https://zhuanlan.zhihu.com/p/104292358)
- [3.3.3 内核态调测工具：kdump&crash——crash 解析 - 知乎](https://zhuanlan.zhihu.com/p/104384020)
- [Linux Kdump 机制详解](https://mp.weixin.qq.com/s/o89Z75IQgah75eW0_qHBtw)
- [【案例】kump 常见问题 | openEuler 社区](https://www.openeuler.org/zh/blog/caselibrary/crash.html)
- [Chapter 19. Analyzing a core dump | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/analyzing-a-core-dump_managing-monitoring-and-updating-the-kernel)
- [pstore block oops/panic logger — The Linux Kernel documentation](https://docs.kernel.org/admin-guide/pstore-blk.html)
- [Linux Kernel Debugging, Kdump, Crash Tool Basics Part-1| Easy Explanation | Youtube - YouTube](https://www.youtube.com/watch?v=6l0ulgv1OJ4)
- [BPF drgn tools — The Linux Kernel documentation](https://docs.kernel.org/bpf/drgn.html)
  - [osandov/drgn: Programmable debugger](https://github.com/osandov/drgn)

```bash
dnf --enablerepo=fedora-debuginfo,updates-debuginfo install kernel-debuginfo
file /usr/lib/debug/lib/modules/$(uname -r)/vmlinux


echo c > /proc/sysrq-trigger
```

## kdump

按照这个步骤来：

1. [Chapter 13. Installing kdump | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/installing-kdump_managing-monitoring-and-updating-the-kernel)
2. [Chapter 14. Configuring kdump on the command line | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/configuring-kdump-on-the-command-line_managing-monitoring-and-updating-the-kernel)
3. [Chapter 16. Enabling kdump | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/enabling-kdumpmanaging-monitoring-and-updating-the-kernel)
4. [Chapter 17. Supported kdump configurations and targets | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/supported-kdump-configurations-and-targets_managing-monitoring-and-updating-the-kernel)
5. [Chapter 19. Analyzing a core dump | Red Hat Product Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/analyzing-a-core-dump_managing-monitoring-and-updating-the-kernel)

学习原理：

1. [3.3.2 内核态调测工具：kdump&amp;crash——kdump - 知乎](https://zhuanlan.zhihu.com/p/104292358)
2. [3.3.3 内核态调测工具：kdump&amp;crash——crash 解析 - 知乎](https://zhuanlan.zhihu.com/p/104384020)
3. [Linux Kdump 机制详解](https://mp.weixin.qq.com/s/o89Z75IQgah75eW0_qHBtw)
4. [Kdump - ArchWiki](https://wiki.archlinux.org/title/Kdump)

## 上手

先确保

```conf
CONFIG_CRASH_DUMP=y
CONFIG_PROC_VMCORE=y
CONFIG_DEBUG_INFO=y
COFNIG_DEBUG_INFO_BTF=y
```

```bash
# 依赖 kdump-utils 包含了 /usr/lib/systemd/system/kdump.service
# 依赖 makedumpfile
dnf install kexec-tools

# 在 usr/share/doc/kdump-utils 里有些指导文档
# 默认内核参数 crashkernel=2G-64G:256M,64G-:512M
# https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/configuring-kdump-on-the-command-line_managing-monitoring-and-updating-the-kernel
kdumpctl get-default-crashkernel

# 其他的一些内核参数：
# oops=panic
# panic_on_warn=1
# softlockup_panic=1 还可通过 sysctl 控制
# unknown_nmi_panic
# workqueue.panic_on_stall=

# 设置好内核参数后重启，会发现预留了 256M 内存
grep Crash /proc/iomem
  6f000000-7effffff : Crash kernel


# 修改配置文件
# KDUMP_KERNELVER="6.15.0-0.rc3.20250421git9d7a0577c9db.28.fc43.x86_64" 填从 fedora 软件仓安装的内核的版本
# KDUMP_COMMANDLINE="rw root=myfs" 第二内核的 initrd 会读这个 root=myfs 参数，将 myfs 挂载为 /sysroot
vim /etc/sysconfig/kdump
# 取消 virtiofs myfs 的注释
# 把 makedumpfile 的 -l 选项 改成 -c（用 zlib 而非 lzo，
# 我发现 archlinux 上的 crash 不支持 lzo，等到 8.0.6-2 应该就支持了
vim /etc/kdump.conf

systemctl enable --now kdump.service
# 每次修改配置后都需要 restart kdump 重新生成一些文件
systemctl restart kdump


新文件 initramfs-6.15.0-0.rc3.20250421git9d7a0577c9db.28.fc43.x86_64kdump.img

# 触发 crash
kdumpctl test
# 或者
echo c > /proc/sysrq-trigger

# 在 archlinux
crash /data/os-code/linux/out/x86_64/vmlinux /data/VMs/fedora_rootfs/var/crash/127.0.0.1-2025-04-23-17:43:26/vmcore
```

- [ ] dracut 何作用？

还要增加的参数，更新内核时，kdump 的 hook 提示我加的
kernel=/boot/vmlinuz-6.15.0-0.rc3.20250421git9d7a0577c9db.28.fc43.x86_64

kdump: Failed to detect kdump kernel location

[ 0.007782] Kernel command line: elfcorehdr=0x6f000000 nokaslr selinux=0 audit=0 console=ttyS0 kernel=/boot/vmlinuz-6.15.0-0.rc3.20250421git9d7a0577c9db.28.fc43.x86_64 iommu=pt intel_iommu=on rootfstype=virtiofs rw irqpoll nr_cpus=1 reset_devices cgroup_disable=memory mce=off numa=off udev.children-max=2 panic=10 acpi_no_memhotplug transparent_hugepage=never nokaslr hest_disable novmcoredd cma=0 hugetlb_cma=0 pcie_ports=compat disable_cpu_apicid=0

[ 0.000000] Linux version 6.15.0-rc2-00087-gcfb2e2c57aef-dirty (hyuuko@archlinux) (clang version 19.1.7, LLD 19.1.7) #27 SMP PREEMPT_DYNAMIC Thu Apr 17 23:57:31 CST 2025
[ 0.000000] Command line: nokaslr selinux=0 audit=0 console=ttyS0 crashkernel=2G-64G:256M,64G-:512M iommu=pt intel_iommu=on rootfstype=virtiofs root=myfs rw

好像 KDUMP_COMMANDLINE_APPEND 没生效？？

```bash
# 估算推荐的 crashkernel 值
kdumpctl estimate
```
