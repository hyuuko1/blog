## alpine

- [cloud-hypervisor/docs/virtiofs-root.md](https://github.com/cloud-hypervisor/cloud-hypervisor/blob/main/docs/virtiofs-root.md)
  使用 virtiofs 作为 guest 的 rootfs

```bash
# 去 https://alpinelinux.org/downloads/ 找最新版的 minirootfs 的下载链接，然后下载
wget https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-minirootfs-3.20.0-x86_64.tar.gz
sudo mkdir alpine-minirootfs
sudo tar -xf alpine-minirootfs-3.19.1-x86_64.tar.gz -C alpine-minirootfs
cd alpine-minirootfs
echo 223.5.5.5 | sudo tee etc/resolv.conf
sudo chroot . /usr/bin/env -i HOME=/root PATH=/bin:/sbin:/usr/bin:/usr/sbin http_proxy=http://127.0.0.1:7897 https_proxy=http://127.0.0.1:7897 /bin/sh

# 更新软件仓库索引
$ apk update
# 安装一些软件
$ apk add pciutils stress-ng numactl-tools
```

```bash
sudo tee init <<EOF
#!/bin/sh
mount -t debugfs none /sys/kernel/debug
mount -t devtmpfs dev /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t tmpfs none /tmp

echo -e "Boot took \$(cut -d' ' -f1 /proc/uptime) seconds"

/sbin/getty -n -l /bin/sh 115200 /dev/console
poweroff -f
EOF

sudo chmod +x init
# 打包命令
sudo find . | sudo cpio -o --format=newc >! ../alpine-minirootfs.img
# 解包命令
# cpio -idmv < ../alpine-minirootfs.img
```

## 怎么用 openrc 那一套进行初始化？

```bash
# --no-check-certificate
$ apk add alpine-base
$ apk info -R alpine-base
alpine-base-3.19.1-r0 depends on:
alpine-baselayout
alpine-conf
alpine-release
apk-tools
busybox
busybox-mdev-openrc
busybox-openrc
busybox-suid
libc-utils
openrc

# 在 etc/init.d 目录有了一些文件
# 接下来，要在 etc/runlevels/ 的几个目录下创建软链接

# https://gitlab.alpinelinux.org/alpine/mkinitfs/-/blob/master/initramfs-init.in?ref_type=heads#L777
rc_add 函数添加一些。。
```

## apk 用法

```bash
apk add PACKAGE # 安装
apk del PACKAGE # 卸载
apk fix PACKAGE # 重装

apk update  # 更新软件仓库索引
apk upgrade # 升级包
apk search  # 搜索包

apk list -I # 已安装的包
apk list -O # 孤立包
apk list -u # 可升级的包

apk info -a PACKAGE # 所有信息
apk info -L PACKAGE # 包含哪些文件
apk info -R PACKAGE # 依赖哪些包
apk info -r PACKAGE # 被哪些包依赖
apk info --replaces PACKAGE # 那些包是替代品
apk info -W FILE    # 哪个包拥有这个文件
```

## gentoo

- [Gentoo Linux 手册：安装 Gentoo - Gentoo Wiki](https://wiki.gentoo.org/wiki/Handbook:AMD64/Full/Installation/zh-cn)
- [Gentoo Linux 安装及使用指南 - bitbili.net](https://bitbili.net/gentoo-linux-installation-and-usage-tutorial.html)

## LFS

##

sudo guestmount -a /s/qemu/debian.qcow -m /dev/sda1 /tmp/qc
