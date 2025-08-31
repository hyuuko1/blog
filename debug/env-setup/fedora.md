# fedora 虚拟机

## virtiofsd

vim /etc/security/limits.conf 避免 virtiofsd 打印出 warning

```conf
hyuuko  hard  nofile  1000000
hyuuko  soft  nofile  1024
```

下载 fedora 的 qcow2 image 文件，挂载，拷贝

```bash
wget https://download.fedoraproject.org/pub/fedora/linux/releases/42/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-42-1.1.x86_64.qcow2
sudo guestmount -a Fedora-Cloud-Base-Generic-42-1.1.x86_64.qcow2 -i /mnt/fedora
mkdir -p /data/VMs/fedora
sudo su
rsync -a --progress /mnt/fedora/* /data/VMs/fedora
sudo guestunmount /mnt/fedora

# chroot 进去，改密码，
# 也可修改 /usr/lib/systemd/system/serial-getty@.service 在 ExecStart=-/sbin/agetty 后面加上 --autologin root 自动登录
sudo chroot /data/VMs/fedora
passwd
# 注释自动挂载的
vim /etc/fstab

chmod 750 /root
```

拉起 virtiofsd

```bash
tee ~/.config/systemd/user/virtiofsd-rootfs.service <<EOF
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

# 把 uid/gid 为 0 的全都改为 1000
sudo chown --from=0:0 -R 1000:1000 /data/VMs/fedora
sudo chown --from=0   -R 1000      /data/VMs/fedora
sudo chown --from=:0  -R :1000     /data/VMs/fedora

# 创建 65536 个 subuid/subgid，范围为 [100000, 165536]，这些 subuid/subgid 都属于实际的 UID/GID 1000
echo 1000:100000:65536 > /etc/subuid
echo 1000:100000:65536 > /etc/subgid
# 把 uid/gid [1, 999] 改为 [100001, 100999]
# 执行的时间会比较长，一分钟左右，这样一来，在虚拟机内就能看到正常的 uid/gid
for id in {1..999}; do
	target=$((100000 + i))
	sudo chown --from=$id  -R $target  /data/VMs/fedora
	sudo chown --from=:$id -R :$target /data/VMs/fedora
done
```

使用本仓库的 [/src/scripts/run-qemu.sh](/src/scripts/run-qemu.sh) 拉起虚机后，

```bash
# 去掉 gpgcheck 并禁用一些 repo
sed -e 's|^gpgcheck=1|gpgcheck=0|g' \
    -i /etc/yum.repos.d/*.repo
sed -e 's|^enabled=1|enabled=0|g' \
    -i /etc/yum.repos.d/fedora-cisco-openh264.repo \
       /etc/yum.repos.d/fedora-updates-testing.repo

dnf remove cloud-init google-noto* tpm2* ntfs-3g* ntfsprogs e2fsprogs tpm2* qemu*
dnf autoremove

# 升级到 rawhide
dnf system-upgrade download --releasever=rawhide
dnf offline reboot
dnf offline clean
dnf autoremove
# 移除旧内核
dnf remove $(dnf repoquery --installonly --latest-limit=-1 -q)
# 查看没升级成功的，仍然是旧版本的，就 dnf upgrade 一次
rpm -qa | grep fc42
dnf upgrade

dnf install pciutils stress-ng vim numactl

systemctl mask sssd.service systemd-update-utmp.service
systemctl disable systemd-resolved.service systemd-resolved-monitor.socket systemd-resolved-varlink.socket
systemctl disable --now chronyd sshd.service systemd-journald-audit.socket
systemctl disable --now systemd-userdbd.service systemd-userdbd.socket
systemctl disable --now auditd.service audit-rules.service
systemctl disable --now dnf-makecache.timer fstrim.timer
```

## dnf

- [DNF Command Reference](https://dnf.readthedocs.io/en/latest/command_ref.html)
- [Upgrading Fedora Linux Using DNF System Plugin :: Fedora Docs](https://docs.fedoraproject.org/en-US/quick-docs/upgrading-fedora-offline/)

```bash
# 查看过去 dnf install 过的软件包
dnf repoquery --userinstalled
dnf list --installed
```
