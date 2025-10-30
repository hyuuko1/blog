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
      text: "体系结构",
      link: "/arch/index",
      activeMatch: "/arch/",
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
    {
      text: "杂项",
      items: [
        {
          text: "其他",
          link: "/other/index",
          activeMatch: "/other/",
        },
        {
          text: "初始化",
          link: "/init/index",
          activeMatch: "/init/",
        },
        {
          text: "电源管理",
          link: "/pm/index",
          activeMatch: "/pm/",
        },
      ],
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
    "/arch/": {
      base: "/arch/",
      items: sidebarArch(),
    },
    "/debug/": {
      base: "/debug/",
      items: sidebarDebug(),
    },
    "/virtualization/": {
      base: "/virtualization/",
      items: sidebarVirtualization(),
    },
    "/other/": {
      base: "/other/",
      items: sidebarOther(),
    },
    "/init/": {
      base: "/init/",
      items: sidebarInit(),
    },
    "/pm/": {
      base: "/pm/",
      items: sidebarPM(),
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
          text: "更新计划",
          link: "update",
        },
        {
          text: "🚧 UTLVMM (Linux 2.6)",
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
        { text: "node", link: "node" },
        { text: "zone", link: "zone" },
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
        { text: "vmap", link: "vmap" },
        { text: "kmap", link: "kmap" },
        { text: "page fault", link: "pagefault" },
        { text: "🚧 page table", link: "page_table" },
        { text: "🚧 ioremap", link: "ioremap" },
        { text: "🚧 fixmap", link: "fixmap" },
        { text: "🚧 highmem 高端内存", link: "highmem" },
        { text: "🚧 CoW (Copy on Write)", link: "cow" },
        { text: "🚧 UFFD (userfaultfd)", link: "uffd" },
        { text: "🚧 share memory", link: "shmem" },
        { text: "🚧 tlb", link: "tlb" },
        { text: "🚧 dma-buf", link: "dma_buf" },
      ],
    },
    {
      text: "内存分配",
      collapsed: false,
      items: [
        { text: "Buddy System: 页面分配器", link: "buddy" },
        { text: "vmalloc: 不连续物理内存分配", link: "vmalloc" },
        { text: "per-cpu 静态和动态分配", link: "percpu" },
        { text: "OOM (Out Of Memory)", link: "oom" },
        { text: "SLUB 内存分配器", link: "slub" },
        { text: "CMA 连续内存分配器", link: "cma" },
        { text: "🚧 早期内存分配器 memblock", link: "memblock" },
        { text: "GFP (Get Free Page)", link: "gfp" },
      ],
    },
    {
      text: "大页",
      collapsed: false,
      items: [
        { text: "HugeTLB 标准大页", link: "hugetlb" },
        { text: "THP (Transparent Huge Page) 透明大页", link: "thp" },
        { text: "mTHP (Multi-size Transparent Huge Page)", link: "mthp" },
      ],
    },
    {
      text: "内存回收",
      collapsed: false,
      items: [
        { text: "内存回收(废弃)", link: "reclaim/reclaim" },
        { text: "内存回收基础", link: "reclaim/basic" },
        { text: "LRU", link: "reclaim/lru" },
        { text: "MGLRU", link: "reclaim/mglru" },
        { text: "workingset", link: "reclaim/workingset" },
        { text: "swap", link: "reclaim/swap" },
        { text: "mlock", link: "mlock" },
      ],
    },
    {
      text: "内存反碎片",
      collapsed: false,
      items: [
        { text: "🚧 内存反碎片", link: "anti-fragmentation" },
        { text: "🚧 内存规整", link: "compaction" },
        { text: "页面迁移", link: "page_migration" },
      ],
    },

    {
      text: "其他",
      collapsed: false,
      items: [
        { text: "GUP (Get User Page)", link: "gup" },
        { text: "pageflags", link: "pageflags" },
        { text: "🚧 madvise", link: "madvise" },
        { text: "🚧 KSM (Kernel Samepage Merging)", link: "ksm" },
        { text: "🚧 hotplug", link: "hotplug" },
        { text: "🚧 virtio mem", link: "virtio_mem" },
        { text: "🚧 virtio pmem", link: "virtio_pmem" },
        { text: "🚧 virtio balloon", link: "virtio_balloon" },
      ],
    },
    {
      text: "Non-Uniform Memory Access architecture",
      collapsed: false,
      items: [{ text: "🚧 Memory Policy 内存策略", link: "mempolicy" }],
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

function sidebarArch(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "x86",
      collapsed: false,
      base: "/arch/x86/",
    },
    {
      text: "ARM",
      collapsed: false,
      base: "/arch/arm/",
      items: [{ text: "AArch64虚拟内存系统架构", link: "virtual_memory" }],
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
        { text: "Git 使用技巧", link: "git" },
      ],
    },
    {
      text: "Tracing",
      collapsed: false,
      items: [{ text: "bpftrace 用法", link: "bpf/bpftrace" }],
    },
  ];
}

function sidebarOther(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "其他",
      collapsed: false,
      items: [
        { text: "Linux 设备模型", link: "device_model" },
        { text: "内核模块", link: "module" },
      ],
    },
  ];
}

function sidebarInit(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "Linux 内核初始化",
      collapsed: false,
      items: [{ text: "initcall", link: "initcall" }],
    },
  ];
}

function sidebarPM(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: "Linux 电源管理",
      collapsed: false,
      items: [
        { text: "ACPI", link: "acpi" },
        { text: "CPU 管理", link: "cpu" },
        { text: "CPU 热插拔", link: "cpu_hotplug" },
      ],
    },
  ];
}
