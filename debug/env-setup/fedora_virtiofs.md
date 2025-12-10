为什么选择 Fedora Rawhide ?

1. 滚动更新，软件包都比较新，Fedora Rawhide 比 ArchLinux 更激进？
2. Linus 也用这个

为什么用 virtiofs ? 因为 vm 与 host 共享目录，有以下好处

1. 不需要制作 initrd，也不需要 qcow2 或 raw 文件，这些用起来都很麻烦
2. 当你在 host 上编译好一个 ko 时，vm 可以直接访问这个 ko，不需要 scp 传文件，也不需要打包 initrd 重新启动 vm

本教程其他的一些特点：

1. qemu 不需要 root 权限
2. 可以在 host 上以普通用户权限 vscode 打开 fedora 虚拟机的根目录（tmpfs 之类的不行），无权限问题。
3. 自动登录 root

如果嫌弃 systemd，也可以不用 fedora，而是选择 alpine 作为 initramfs，同时用 virtiofsd 把 host 上的代码共享给虚拟机，然后在 host 上编译模块，在 alpine 内加载模块。

## 内核编译

[kernel-build](./kernel-build.md)

为什么在 host 编译内核，而不是在虚拟机里面？

1. 要在 host 上生成 compile_commands.json，用 host 上的 vscode+clangd 看代码
2. 在虚拟机里编译，速度会受限于 virtiofs 的 IO。

用户态程序因为涉及到很多 so 的依赖，因此一定要在虚拟机内编译（或者 chroot/lxc 进去编译）

## 解决虚拟机内 cap_set_file 失败问题

error: unpacking of archive failed on file /usr/bin/newgidmap;6808dda3: cpio: cap_set_file failed - Operation not supported

```bash
cat >fakecap.c <<EOF
#include <sys/capability.h>
int cap_set_file(const char *path_p, cap_t cap_p) { return 0; }
int cap_set_fd(int fd, cap_t caps) { return 0; }
EOF
gcc fakecap.c -shared -fPIC -o fakecap.so
# 测试
LD_PRELOAD=`pwd`/fakecap.so setcap cap_setgid+ep /path/to/test_file


LD_PRELOAD=/root/fakecap.so  dnf --refresh upgrade

# 如果报错 Error: GPG check FAILED 就加上 --nogpgcheck
LD_PRELOAD=/root/fakecap.so dnf system-upgrade download --releasever=rawhide --nogpgcheck
LD_PRELOAD=/root/fakecap.so dnf system-upgrade reboot
```

1. [ ] 继续精简测试环境，移除一些包
2. [ ] 注意，有些文件之前的 uid:guid 不是 0:0 没设置成正确的映射后的值。

--downloadonly

## qemu 无法正确处理 amd numa

https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/html/9.5_release_notes/known-issues-virtualization#known-issues-virtualization
NUMA 节点映射在 AMD EPYC CPU 上无法正常工作

QEMU 无法正确处理 AMD EPYC CPU 上的 NUMA 节点映射。因此，如果使用 NUMA 节点配置，具有这些 CPU 的虚拟机(VM)的性能可能会受到负面影响。另外，虚拟机在启动过程中会显示类似如下的警告。

sched: CPU #4's llc-sibling CPU #3 is not on the same node! [node: 1 != 0]. Ignoring dependency.
WARNING: CPU: 4 PID: 0 at arch/x86/kernel/smpboot.c:415 topology_sane.isra.0+0x6b/0x80
要临时解决这个问题，请不要将 AMD EPYC CPU 用于 NUMA 节点配置。

```bash
dnf remove abattis-cantarell-vf-fonts adobe-source-code-pro-fonts adwaita-mono-fonts adwaita-sans-fonts

# TODO 移除
avahi
fwupd
e2fsprogs
samba
kernel-core kernel-modules-core

# 不安装 weak dependencies
dnf install kernel-core kernel-modules-core --setopt=install_weak_deps=False
```

Failed to set wall message, ignoring: Could not activate remote peer 'org.freedesktop.login1': activation request failed: unit is invalid
Call to Reboot failed: Could not activate remote peer 'org.freedesktop.login1': activation request failed: unit is invalid

这是 systemctl mask systemd-logind.service 导致的，unmask 回来就好了。

##

[Creating a virtual machine using a distribution’s Cloud base image – the example of CentOS :: Fedora Docs](https://docs.fedoraproject.org/en-US/fedora-server/virtualization/vm-install-cloudimg-centos9/)

```bash
# https://fedoraproject.org/cloud/download
wget https://download.fedoraproject.org/pub/fedora/linux/releases/42/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-42-1.1.x86_64.qcow2

# https://cloud-init.io
$ cat << EOF > user-data
#cloud-config
system_info:
  default_user:
    name: root
    plain_text_passwd: root
    lock_passwd: False
ssh_pwauth: True
EOF
$ cloud-localds seed.img user-data

```

[fedora 镜像\_fedora 下载地址\_fedora 安装教程-阿里巴巴开源镜像站](https://developer.aliyun.com/mirror/fedora/)
