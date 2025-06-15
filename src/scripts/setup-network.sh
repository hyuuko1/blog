#!/bin/sh

# https://gist.github.com/extremecoders-re/e8fd8a67a515fee0c873dcafc81d811c?permalink_comment_id=3624770#gistcomment-3624770

# 创建网桥 br0，启用
ip link add br0 type bridge
ip link set br0 up
ip addr add 10.0.0.1/24 dev br0

# 创建 tap 设备，添加到 br0 并启用 tap0
ip tuntap add mode tap user 1000 tap0
ip link set tap0 up master br0

ip tuntap add mode tap user 1000 tap1
ip link set tap1 up master br0

# 如果不是wifi，那可以直接把网卡放进网桥，不需要 NAT 了
# 清除网卡的 IP，添加进 br0
# ip addr flush dev eth0
# ip link set eth0 master br0

# 其实如果不用 DHCP 那没必要用 dnsmasq 了。
# 租约文件记录在 /var/lib/misc/dnsmasq.leases
dnsmasq -C /dev/null --interface=br0 --bind-interfaces --dhcp-range=10.0.0.2,10.0.0.254

# 允许转发
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null 2>&1
# 对来自 10.0.0.0/24 并去往 10.0.0.0/24 的都直接接受，不进行 NAT ？
iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -d 10.0.0.0/24 -j ACCEPT
# 对其他来自 10.0.0.0/24 的则进行 NAT
iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -j MASQUERADE
# 更多配置见 virtualization/vdpa/环境搭建的分析.md

# 如果想删除 nat table 里的表项
# iptables -t nat -D POSTROUTING 1

# 虚拟机内
# ip addr add 10.0.0.2/24 dev enp0s1
# ip link set dev enp0s1 up
# ip route add default via 10.0.0.1
# export http_proxy=http://10.0.0.1:7897
# export https_proxy=http://10.0.0.1:7897
# ping www.baidu.com
