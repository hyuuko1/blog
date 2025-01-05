---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

titleTemplate: "主页"

hero:
  name: "Notes"
  text: "linux kernel, qemu"
  tagline: 一些内核知识
  image:
    src: /linux.svg
    alt: VitePress
  actions:
    - theme: brand
      text: README
      link: /README
    - theme: alt
      text: Markdown Examples
      link: /markdown-examples

features:
  - title: 内存管理
    link: /mm
    details: e820, memblock, slub, buddy system, hugepage, THP
  - title: 网络
    link: /
    details: kernel TCP/IP stack, DPDK, RDMA, XDP
  - title: 存储
    link: /
    details: VFS, SPDK
  - title: 虚拟化
    link: /
    details: KVM, QEMU, Virtio, VFIO, Libvirt, Cloud-Hypervisor
  - title: 容器
    link: /
    details: Docker, k8s, Kata
  - title: Trace/Debug
    link: /
    details:
  - title: 设备与中断
    link: /
    details: device/driver/bus, hardirq, softirq, tasklet, workqueue, MSI-X, APIC, GICv4
  - title: 体系结构
    link: /arch
    details: 一些ISA相关的内容
  - title: Booting
    link: /
    details: SeaBIOS, edk2, Linux Boot Process
  - title: Programming Language
    link: /
    details: Rust, Go, Zig
---
