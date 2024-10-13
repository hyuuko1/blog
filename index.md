---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

titleTemplate: "主页"

hero:
  name: "Notes"
  text: "linux kernel / qemu"
  tagline: My great project tagline
  image:
    src: /linux.svg
    alt: VitePress
  actions:
    - theme: brand
      text: Markdown Examples
      link: /markdown-examples
    - theme: alt
      text: API Examples
      link: /api-examples

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
  - title: Interrupt
    link: /irq
    details: hardirq, softirq, tasklet, workqueue, MSI-X, APIC, GICv4
  - title: Booting
    link: /
    details: SeaBIOS, edk2, Linux Boot Process
  - title: Programming Language
    link: /
    details: Haskell, Rust, Go, Zig
---
