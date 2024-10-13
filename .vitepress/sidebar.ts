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
      items: sidebarIrq(),
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
        { text: "e820", link: "e820" },
        { text: "node, zone", link: "node" },
        { text: "🚧 struct page", link: "page" },
        { text: "🚧 struct folio", link: "folio" },
      ],
    },
    {
      text: "内存映射",
      collapsed: false,
      items: [
        {
          text: "pfn_to_page() 的原理：mem_section 与 vmemmap",
          link: "vmemmap",
        },
        { text: "🚧 page fault", link: "pagefault" },
        { text: "🚧 page table", link: "page_table" },
        { text: "🚧 mmap", link: "mmap" },
        { text: "🚧 rmap 反响映射", link: "rmap" },
        { text: "🚧 ioremap", link: "ioremap" },
        { text: "🚧 fixmap", link: "fixmap" },
        { text: "🚧 highmem 高端内存", link: "highmem" },
        { text: "🚧 GUP (Get User Page)", link: "gup" },
        { text: "🚧 GFP (Get Free Page)", link: "gfp" },
        { text: "🚧 CoW (Copy on Write)", link: "cow" },
        { text: "🚧 THP (Transparent Huge Page) 动态大页", link: "thp" },
        { text: "🚧 userfaultfd", link: "userfaultfd" },
        { text: "🚧 share memory", link: "shmem" },
        { text: "🚧 mlock", link: "mlock" },
        { text: "🚧 tlb", link: "tlb" },
        { text: "🚧 hugetlb", link: "hugetlb" },
      ],
    },
    {
      text: "内存分配",
      collapsed: false,
      items: [
        { text: "🚧 早期内存分配器 memblock", link: "memblock" },
        { text: "🚧 SLUB 内存分配器", link: "slub" },
        { text: "🚧 Buddy System 伙伴系统", link: "buddy" },
        { text: "🚧 vmalloc", link: "vmalloc" },
        { text: "🚧 CMA 连续内存分配", link: "cma" },
        { text: "🚧 页面回收和交换", link: "swap" },
        { text: "🚧 内存压缩", link: "compaction" },
        { text: "🚧 页面迁移", link: "migration" },
        { text: "🚧 OOM (Out Of Memory) Killer", link: "oom" },
        { text: "🚧 KSM (Kernel Samepage Merging)", link: "ksm" },
        { text: "🚧 hotplug", link: "hotplug" },
        { text: "🚧 virtio mem", link: "virtio_mem" },
        { text: "🚧 virtio pmem", link: "virtio_pmem" },
        { text: "🚧 virtio balloon", link: "virtio_balloon" },
      ],
    },
    {
      text: "其他内存管理相关",
      collapsed: false,
      items: [
        { text: "🚧 readahead 预读", link: "../storage/readahead" },
        { text: "🚧 page cache", link: "../storage/page_cache" },
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
        { text: "🚧 page cache", link: "page_cache" },
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
      text: "TCP/IP",
      collapsed: false,
      items: [
        { text: "收包流程", link: "rx" },
        { text: "发包流程", link: "tx" },
      ],
    },
  ];
}

function sidebarProcess(): DefaultTheme.SidebarItem[] {
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

function sidebarIrq(): DefaultTheme.SidebarItem[] {
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

function sidebarDebug(): DefaultTheme.SidebarItem[] {
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
