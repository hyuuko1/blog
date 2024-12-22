import { type DefaultTheme } from "vitepress";

export function nav(): DefaultTheme.NavItem[] {
  return [
    { text: "内存管理", link: "/mm/index", activeMatch: "/mm/" },
    { text: "网络", link: "/net/index", activeMatch: "/net/" },
    { text: "存储", link: "/storage/index", activeMatch: "/storage/" },
    {
      text: "进程",
      link: "/process/index",
      activeMatch: "/process/",
    },
    {
      text: "中断",
      link: "/irq/index",
      activeMatch: "/irq/",
    },
    {
      text: "调试",
      link: "/debug/index",
      activeMatch: "/debug/",
    },
    {
      text: "虚拟化",
      link: "/virtualization/index",
      activeMatch: "/virtualization/",
    },
  ];
}

export function sidebar(): DefaultTheme.Sidebar {
  return {
    "/mm/": { base: "/mm/", items: sidebarMM() },
    "/net/": { base: "/net/", items: sidebarNet() },
    "/storage/": {
      base: "/storage/",
      items: sidebarStorage(),
    },
    "/process/": {
      base: "/process/",
      items: sidebarProcess(),
    },
    "/irq/": {
      base: "/irq/",
      items: sidebarIRQ(),
    },
    "/debug/": {
      base: "/debug/",
      items: sidebarDebug(),
    },
    "/virtualization/": {
      base: "/virtualization/",
      items: sidebarVirtualization(),
    },
  };
}

function sidebarMM(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "前言",
      collapsed: false,
      items: [
        {
          text: "🚧 《Understanding the Linux Virtual Memory Manager》Linux 2.6",
          link: "gorman_book",
        },
      ],
    },
    {
      text: "描述物理内存",
      collapsed: false,
      items: [
        { text: "内存布局", link: "layout" },
        { text: "e820", link: "e820" },
        { text: "node, zone", link: "node" },
        { text: "struct page/folio 详解", link: "folio" },
        {
          text: "pfn_to_page() 的原理：mem_section 与 vmemmap",
          link: "vmemmap",
        },
      ],
    },
    {
      text: "虚拟内存映射",
      collapsed: false,
      items: [
        { text: "rmap 反向映射", link: "rmap" },
        { text: "vma", link: "vma" },
        { text: "mmap", link: "mmap" },
        { text: "🚧 page fault", link: "pagefault" },
        { text: "🚧 page table", link: "page_table" },
        { text: "🚧 ioremap", link: "ioremap" },
        { text: "🚧 fixmap", link: "fixmap" },
        { text: "🚧 highmem 高端内存", link: "highmem" },
        { text: "🚧 GUP (Get User Page)", link: "gup" },
        { text: "🚧 GFP (Get Free Page)", link: "gfp" },
        { text: "🚧 CoW (Copy on Write)", link: "cow" },
        { text: "🚧 UFFD (userfaultfd)", link: "uffd" },
        { text: "🚧 share memory", link: "shmem" },
        { text: "🚧 mlock", link: "mlock" },
        { text: "🚧 tlb", link: "tlb" },
        { text: "🚧 dma-buf", link: "dma_buf" },
      ],
    },
    {
      text: "内存分配",
      collapsed: false,
      items: [
        { text: "vmalloc: 不连续物理内存分配与 vmap", link: "vmalloc" },
        { text: "per-cpu 变量的静态和动态分配", link: "percpu" },
        { text: "Buddy System 伙伴系统: 物理页面分配", link: "buddy" },
        { text: "OOM (Out Of Memory) Killer", link: "oom" },
        { text: "SLUB 内存分配器", link: "slub" },
        { text: "CMA 连续内存分配器", link: "cma" },
        { text: "🚧 早期内存分配器 memblock", link: "memblock" },
        { text: "🚧 THP (Transparent Huge Page) 透明大页", link: "thp" },
        { text: "🚧 HugeTLB 大页内存", link: "hugetlb" },
        { text: "🚧 页面回收和交换", link: "swap" },
        { text: "🚧 内存压缩", link: "compaction" },
        { text: "🚧 页面迁移", link: "migration" },
        { text: "🚧 KSM (Kernel Samepage Merging)", link: "ksm" },
        { text: "🚧 hotplug", link: "hotplug" },
        { text: "🚧 virtio mem", link: "virtio_mem" },
        { text: "🚧 virtio pmem", link: "virtio_pmem" },
        { text: "🚧 virtio balloon", link: "virtio_balloon" },
      ],
    },
    {
      text: "内存管理与文件系统",
      collapsed: false,
      items: [
        { text: "🚧 readahead 预读", link: "../storage/readahead" },
        { text: "🚧 page cache", link: "../storage/pagecache" },
        { text: "🚧 page writeback", link: "../storage/page_writeback" },
        { text: "🚧 tmpfs", link: "../storage/tmpfs" },
        { text: "🚧 ramfs", link: "../storage/ramfs" },
      ],
    },
  ];
}

function sidebarNet(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "TCP/IP",
      collapsed: false,
      items: [
        { text: "收包流程", link: "rx" },
        { text: "发包流程", link: "tx" },
      ],
    },
  ];
}

function sidebarStorage(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "Linux 内核文件系统",
      collapsed: false,
      items: [
        { text: "🚧 page cache", link: "pagecache" },
        { text: "🚧 readahead 预读", link: "readahead" },
        { text: "🚧 VFS", link: "vfs" },
        { text: "🚧 tmpfs", link: "tmpfs" },
        { text: "🚧 ramfs", link: "ramfs" },
      ],
    },
  ];
}

function sidebarVirtualization(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "QEMU-KVM",
      collapsed: false,
      items: [
        { text: "事件循环", link: "mainloop" },
        { text: "内存虚拟化", link: "mm" },
      ],
    },
    {
      text: "VFIO",
      collapsed: false,
      items: [
        { text: "vfio-pci", link: "vfio-pci" },
        { text: "vfio-mdev", link: "vfio-mdev" },
      ],
    },
  ];
}

function sidebarProcess(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "调度",
      collapsed: false,
      items: [
        { text: "CFS", link: "CFS" },
        { text: "EEVDF", link: "EEVDF" },
      ],
    },
  ];
}

function sidebarIRQ(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "Linux IRQ",
      collapsed: false,
      items: [
        { text: "Linux IRQ", link: "irq" },
        { text: "MSI-X", link: "msix" },
      ],
    },
  ];
}

function sidebarDebug(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "Debug",
      collapsed: false,
      items: [
        { text: "Tips & Tricks", link: "tips" },
        { text: "vscode + gdb 调试 Linux 内核", link: "vscode-gdb" },
        { text: "GDB 用法", link: "gdb" },
      ],
    },
    {
      text: "Tracing",
      collapsed: false,
      items: [{ text: "bpftrace 用法", link: "bpf/bpftrace" }],
    },
  ];
}
