# 搭建环境

为了学习内核，通过 QEMU + GDB 进行调试。
我的 laptop 运行的是 ArchLinux。
用于调试、学习用途的虚拟机，我考虑过 Alpine/Arch/Gentoo/NixOS，最后选择 Fedora Rawhide，优点：

1. 滚动更新，软件包都比较新，Fedora Rawhide 比 ArchLinux 更激进？
2. Linus 也用这个

本教程其他的一些特点：

1. 通过 virtio-fs 使 Guest 与 Host 共享目录，无需通过 scp 传文件。
2. 绑核，并且在 Guest 中运行的程序尽可能地少，避免做性能分析的时候受干扰。
3. 启动速度很快。
4. 不需要制作 initrd，因为根本用不到！
5. qemu 不需要 root 运行
6. 可以直接用 vscode 打开 fedora 的文件，无权限问题

如果嫌弃 systemd，也可以不用 fedora，而是选择 alpine 作为 initramfs，同时用 virtiofsd 把 host 上的代码共享给虚拟机，然后在 host 上编译模块，在 alpine 内加载模块。

## virtiofsd

第一步，为 fedora 虚拟机准备好根目录。
先在 https://fedoraproject.org/cloud/download 下载最新版的 Fedora Cloud 虚拟机镜像，此处以 Fedora-Cloud-Base-AmazonEC2.x86_64-40-1.14.raw.xz 为例。

```bash
# 下载虚拟机镜像
$ wget https://download.fedoraproject.org/pub/fedora/linux/releases/40/Cloud/x86_64/images/Fedora-Cloud-Base-AmazonEC2.x86_64-40-1.14.raw.xz
# 解压
$ xz -dk Fedora-Cloud-Base-AmazonEC2.x86_64-40-1.14.raw.xz
# 绑定到回环设备
$ sudo losetup -Pf Fedora-Cloud-Base-AmazonEC2.x86_64-40-1.14.raw
# 查看绑定到了哪个回环设备
$ losetup
NAME       SIZELIMIT OFFSET AUTOCLEAR RO BACK-FILE                                                DIO LOG-SEC
/dev/loop0         0      0         0  0 /data/VMs/Fedora-Cloud-Base-AmazonEC2.x86_64-40-1.14.raw   0     512
# 通过 lsblk -f /dev/loop0 和 sudo fdisk -l /dev/loop0 命令查看分区
# 感觉 /dev/loop0p4 这个 btrfs 像是根分区
# /dev/loop0p3 是 boot 分区
# 挂载到 /mnt
$ sudo mount /dev/loop0p4 /mnt
# 可以看到，实际上，这个 btrfs 有 3 个 subvolume，其中 root 是作为系统的根目录的
$ sudo btrfs subvolume list /mnt
ID 256 gen 13 top level 5 path root
ID 257 gen 8 top level 5 path home
ID 258 gen 11 top level 5 path var
# 将 boot 分区挂载到正确的位置
$ sudo mount /dev/loop0p3 /mnt/root/boot
# 创建一个目录，后面启动虚机时，这个目录会作为虚机的根目录
$ mkdir /data/VMs/fedora_rootfs
# 将文件同步过去
$ sudo rsync -a --progress /mnt/root/* /data/VMs/fedora_rootfs
# 现在虚拟机的根目录已经准备好了。
# 取消挂载、删除回环设备
$ sudo umount /mnt/root/boot
$ sudo umount /mnt
$ sudo losetup -d /dev/loop0
```

如果想要将 host 的其他目录也共享给虚拟机，可以这样做：

```bash
# https://gitlab.com/virtio-fs/virtiofsd#faq
# 创建一个空目录
$ sudo mkdir /data/VMs/fedora_rootfs/root/code
# 进行 bind mount，将 /data/code 挂载到 /data/VMs/fedora_rootfs/root/code
# 这样一来，访问 /data/VMs/fedora_rootfs/root/code 时，其实是在访问 /data/code
# 如果想只读，将 -o bind 改为 -o bind,ro
$ sudo mount -o bind /data/code /data/VMs/fedora_rootfs/root/code
# 在 /etc/fstab 增加一行，开机时自动进行 bind mount
$ sudo tee -a /etc/fstab <<EOF
/data/code  /data/VMs/fedora_rootfs/root/code   none  bind,nofail
EOF

# 改文件的 UID
$ sudo chown --from=0:0 -R 1000:1000 /data/VMs/fedora_rootfs/
```

接下来就是启动 virtiofsd 了，写一个 service，让 virtiofsd 每次正常退出后都重启
mount -t virtiofs myfs /mnt

```bash
# 注意先看一下，这两个文件可能已经存在了
# 会创建 65536 个 subuid，范围为 [100000, 165536]，这些 subuid 都属于实际的 UID 1000
$ echo 1000:100000:65536 > /etc/subuid
$ echo 1000:100000:65536 > /etc/subgid


$ tee ~/.config/systemd/user/virtiofsd-rootfs.service <<EOF
# https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
[Unit]
Description=virtiofsd share directory for fedora VM

[Service]
Type=simple
Restart=on-success
# --xattr 是为了支持 setcap
# --announce-submounts 是为了防止在 mount bind 的情况下数据出错
# --uid-map=:namespace_uid:host_uid:count: 其中 namespace_uid 是指虚拟机内的 uid
# --uid-map=:0:1000:1: 是指把虚拟机的 uid 0 映射到宿主机的 uid 1000
# --uid-map=:1:100001:65535: 是指把虚拟机的 uid [1, 65536] 映射到宿主机的 uid [100001, 165536]
ExecStart=/usr/lib/virtiofsd --shared-dir /data/VMs/fedora --socket-path /tmp/vfsd.sock \
	--uid-map=:0:1000:1: --uid-map=:1:100001:65535: \
	--gid-map=:0:1000:1: --gid-map=:1:100001:65535: \
	--announce-submounts --xattr --posix-acl --security-label \
	--sandbox namespace

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now virtiofsd-rootfs.service
```

## QEMU 启动虚拟机

- [virtiofs - shared file system for virtual machines](https://virtio-fs.gitlab.io/howto-qemu.html)

```bash
# 先 chroot 进去修改一些东西
$ sudo chroot /data/VMs/fedora_rootfs /bin/bash
# 设置 root 密码
$ passwd
# 修改 /etc/fstab，全部加 # 注释掉，或者全部删除
$ vi /data/VMs/fedora_rootfs/etc/fstab

# Ctrl D 退出 chroot
# 启动虚机。
# 注意：如果不带 selinux=0 会导致启动失败，解决办法见 https://gitlab.com/virtio-fs/virtiofsd#selinux-support 我懒得折腾了
sudo qemu-system-x86_64 -nodefaults \
  -kernel /data/VMs/fedora_rootfs/boot/vmlinuz-6.8.5-301.fc40.x86_64 \
  -initrd /data/VMs/fedora_rootfs/boot/initramfs-6.8.5-301.fc40.x86_64.img \
  -append "selinux=0 audit=0 nokaslr console=ttyS0 rootfstype=virtiofs root=myrootfs rw" \
  -machine q35,accel=kvm,sata=off,smbus=off,usb=off \
  -cpu host -smp cpus=4,sockets=1,threads=2,maxcpus=32 \
  -m 8G -object memory-backend-file,id=ram0,size=8G,mem-path=/dev/shm,share=on \
  -numa node,memdev=ram0 \
  -chardev socket,id=char0,path=/tmp/virtiofsd_rootfs.socket \
  -device vhost-user-fs-pci,chardev=char0,tag=myrootfs \
  -qmp unix:/tmp/qmp-sock,server,nowait \
  -nographic -serial mon:stdio \
  -pidfile /tmp/qemu-fedora.pid
```

此时，我们启动的仍然是 fedora 的内核。
接下来，会讲如何使用自己的内核，以及，如何绕过 initramfs 直接让内核挂载硬盘根分区！
[代码分析可以看这篇](/init/initrd.md)

## 在虚拟机内的一些修改

**目标：systemd 启动的服务尽可能地少，启动尽可能的快**

- root 用户的密码设置成了 root
- lspci -k 报错：
  lspci: Unable to load libkmod resources: error -2
  用 strace 看了一下，原因是没找到文件 /lib/modules/6.9.0-rc4-00214-g13a2e429f644-dirty/modules.dep.bin
  要用 depmod 命令生成？
- /etc/fstab 都注释了

```bash
# XXX 参考 LSF 里用 -i 选项
sudo chroot /data/VMs/fedora_rootfs /bin/bash

# cloud-init 是用来第一次启动虚机进行初始化的（比如设置密码），实际上我们没用到
# https://cloud-init.io
dnf remove cloud-init

# 升级为 rawhide
# https://docs.fedoraproject.org/en-US/quick-docs/upgrading-fedora-offline/
dnf upgrade --refresh
dnf install dnf-plugin-system-upgrade
dnf system-upgrade download --releasever=rawhide
dnf system-upgrade reboot

# 安装一些工具
dnf install pciutils stress-ng vim numactl

# boot 时间分析
systemd-analyze plot > fedora_vm_boot.svg
# 分析最影响启动速度的几个 service
# 后面可以跟参数，比如 systemd-analyze critical-chain getty@tty1.service
systemd-analyze critical-chain

# ntp 同步是不需要的。因为虚机是通过 kvm 获取时间的？
systemctl disable --now chronyd
systemctl disable --now systemd-userdbd.service systemd-userdbd.socket
systemctl disable --now auditd.service audit-rules.service
systemctl disable --now avahi-daemon.service avahi-daemon.socket dnf-makecache.timer fstrim.timer raid-check.timer

[root@localhost ~]# systemctl disable --now sshd.service
Removed "/etc/systemd/system/multi-user.target.wants/sshd.service".

[root@localhost ~]# systemctl disable systemd-resolved.service
Removed "/etc/systemd/system/dbus-org.freedesktop.resolve1.service".
Removed "/etc/systemd/system/sysinit.target.wants/systemd-resolved.service"

systemctl mask systemd-tmpfiles-setup-dev-early.service systemd-tmpfiles-setup-dev.service systemd-tmpfiles-setup.service systemd-tmpfiles-clean.timer

# 感觉将来可能用得到但现在用不到的。在内核参数里设置 ip= 让 systemd 生成网络配置
systemctl disable systemd-network-generator.service

# 创建一个空的文件，以禁用 /usr/lib/systemd/zram-generator.conf
touch /etc/systemd/zram-generator.conf


systemctl mask systemd-vconsole-setup.service
systemctl mask systemd-update-utmp.service
systemctl disable udisks2.service
systemctl disable NetworkManager.service

systemctl disable systemd-homed.service
Removed "/etc/systemd/system/dbus-org.freedesktop.home1.service".
Removed "/etc/systemd/system/multi-user.target.wants/systemd-homed.service".
Removed "/etc/systemd/system/systemd-homed.service.wants/systemd-homed-activate.service".

# mask 这些后，其实仍然是可以登录的
systemctl mask systemd-logind.service
systemctl mask systemd-user-sessions.service

systemctl disable lvm2-monitor.service
```

fedora 开了 systemd-journald-audit.socket 因此 journald 会收集 aduit 信息
archlinux 没开这个 socket，所以可以看到日志里有 archlinux systemd-journald[472]: Collecting audit messages is disabled.

python3-dnf-plugin-tracer
/usr/lib/python3.12/

- [ ] poweroff 时有报错
      Failed to set wall message, ignoring: Could not activate remote peer: activation request failed: unit is invalid.
      Call to PowerOff failed: Could not activate remote peer: activation request failed: unit is invalid.

## 自动登录为 root

https://serverfault.com/a/763408

`vi /usr/lib/systemd/system/serial-getty@.service`

在 `ExecStart=-/sbin/agetty` 后面加个选项 `--autologin root`

## QEMU 免 root 运行

第一次启动 QEMU 前，先执行一遍以下命令

```bash
sudo chmod 777 /dev/hugepages/

# 创建网桥 br0，启用
sudo ip link add br0 type bridge
sudo ip link set br0 up
# 清除网卡的 IP，添加进 br0
sudo ip addr flush dev eth0
sudo ip link set eth0 master br0
# 创建 tap 设备，添加到 br0 并启用 tap0
sudo ip tuntap add mode tap user $(whoami) tap0
sudo ip link set tap0 up master br0

# TODO 貌似也可以不用这种方法：让 virtiofsd 直接运行在 non-root user
# https://gitlab.com/virtio-fs/virtiofsd
# 这个每次都要重新运行一遍？可以把这个放在 qemu 启动脚本里
sudo chmod 777 /tmp/virtiofsd_rootfs.socket
```

qemu 的 -netdev 选项 script=no,downscript=no 不用 qemu-ifup.sh

## 虚拟机网络

现在安装软件是通过 chroot

- [ ] 无线网卡没法绑到网桥里，考虑用 NAT ？

## 制作自己的内核

必须支持的几个 config

- CONFIG_PVH
  可以直接使用 vmlinux 启动，无需编译 bzImage
- CONFIG_VIRTIO_FS
  直接使用 host 的目录
- [ ] CONFIG_TRANSPARENT_HUGEPAGE 不能和 CONFIG_PREEMPT_RT 同时用，为什么？

原则：
如果某些代码不会修改它，那就 =y 编译内核，
如果自己会频繁修改某些代码进行调试，那就 =m 做成模块。

注意，有些以 `_TEST` 结尾的选项，会自动运行测试代码，建议弄成模块。

```bash
alias mk="make LLVM=1 O=out/x86_64 -j$(nproc)"

# 编译内核
mk vmlinux
# 会编译所有该编译的代码，并生成 compile_commands.json
mk compile_commands.json

# 模块安装到虚机的 /lib/modules/`uname -r` 目录
sudo mk INSTALL_MOD_PATH=/data/VMs/fedora_rootfs modules_install
```

我常用的几个 config 命令

```bash
# 对现有的 .config 进行更新，常用于 git pull 新版本内核后进行编译
make oldconfig
# 与 oldconfig 类似，但对于新的选项，不会问我们选啥，而是直接默认值
make olddefconfig
# 用当前的 .config 制作出 defconfig
make savedefconfig
```

每当 git pull 更新内核后，都 make olddefconfig 然后 make savedefconfig 与原先的 defconfig 进行对比，看看有哪些地方变了。

**更新内核代码**

```bash
git stash
git pull
git stash pop # 可能要处理冲突

mk olddefconfig   # 对 .config 进行更新
mk savedefconfig  # 生成 defconfig
# 保存，与上一次的对比，看看有哪些 config 的变动
cp out/x86_64/defconfig arch/x86/configs/20241123_defconfig
```

## 编译环境

代码目录通过 bind mount 的方式让虚机能直接访问，因此编译产物无需通过 scp 传到虚机。

目标：编译时，不要对虚机的运行状态产生影响，比如正在用 perf 采样性能数据时，尽可能地没有别的程序干扰。

1. 要在虚拟机里运行的程序，建议 chroot 进去再编译。
2. 内核和模块可以在 host 内编译。

## 还需要做的工作

- 如何突破终端 80 列的限制？
  1. 设置 COLUMNS 环境变量
  2. 内核里可以改默认的列数
  3. stty rows 50 和 stty cols 132 命令
- 支持热插拔。pci 支持吗？
- 试试用 cloud-hypervisor 来 debug，支持软件断点吗？虚拟机启动速度会更快一些
- [ ] 把 host 的 /tmp 目录绑定到 rootfs 里，这样虚机记录 trace 时写到 host 的 tmp 里，防止频繁读写硬盘。

遗留问题

- [ ] CONFIG_PVH 可以直接用 vmlinux 启动！但是目前只在 -bios /usr/share/qemu/bios-256k.bin 的场景下成功启动过。用 OVMF 时就不行，这是为什么？

## 以 root 启动 QEMU 时，如何 vscode 调试？

为了支持 qemu root 运行，需要：创建一个文件内容为 `sudo pkexec /usr/bin/gdb "$@"`
launch.json 里填 `"miDebuggerPath": "/path/to/这个文件"`

[用 GDB 或 CDT 調試 qemu 時， 它會不停 fire SIGUSR1_qemu sigusr1-CSDN 博客](https://blog.csdn.net/cmk128/article/details/8579134)
但实际上，代码目录下的 .gdbinit 会执行 scripts/qemu-gdb.py 进而执行 gdb.execute('handle SIGUSR1 pass noprint nostop') 才对啊。
sudo vim /root/.gdbinit 写入 `add-auto-load-safe-path /data/os-code/qemu/.gdbinit` 还是没用啊。。

只好 `sudo pkexec /usr/bin/gdb -iex "handle SIGUSR1 pass noprint nostop" "$@"` 了

## 调试内核

见 [开发环境配置.md](../开发环境配置.md)

## 脚本

```bash
$ lspci
00:00.0 Host bridge: Intel Corporation 82G33/G31/P35/P31 Express DRAM Controller
00:01.0 Mass storage controller: Red Hat, Inc. Virtio file system (rev 01)
# 是南桥？一些低速设备会接入这里？需要 CONFIG_LPC_ICH=m 编译 lpc_ich 驱动
# 在 pc_q35_init 里直接调用的 pci_realize_and_unref，好像没法禁用这个？
00:1f.0 ISA bridge: Intel Corporation 82801IB (ICH9) LPC Interface Controller (rev 02)
```

## 报错及解决办法

遇到问题看 /data/VMs/fedora/boot/config-6.9.0-0.rc0.20240315gite5eb28f6d1af.7.fc41.x86_64

### tmpfs: Unknown parameter 'mode'

[ 0.909578] tmpfs: Unknown parameter 'mode'
[ 0.910014] systemd[1]: Failed to mount tmpfs (type tmpfs) on /dev/shm (MS_NOSUID|MS_NODEV|MS_STRICTATIME "mode=01777"): Invalid argument
[ 0.911219] tmpfs: Unknown parameter 'mode'
[ 0.911638] systemd[1]: Failed to mount tmpfs (type tmpfs) on /run (MS_NOSUID|MS_NODEV|MS_STRICTATIME "mode=0755,size=20%,nr_inodes=800k"): Invalid argument
[Ayufan 5.4.0 rc1 release - cannot boot](https://forum.pine64.org/showthread.php?tid=8200)

需要启用这几个命令行
CONFIG_TMPFS=y
CONFIG_TMPFS_POSIX_ACL=y
CONFIG_TMPFS_XATTR=y

### 不能加载 zram

先启用 CRYPTO_LZO 或者 CRYPTO_ZSTD 等等
再启用 ZRAM

## 方案

比如 https://gist.github.com/joelagnel/37502e01b2f6052620bafc560a26b019 里的 ignore-stdin-for-secs.sh

https://gist.github.com/joelagnel/37502e01b2f6052620bafc560a26b019
https://gist.github.com/joelagnel/b4a640058d577086c2d5280cd698ee63
