import { type DefaultTheme } from "vitepress";

export function nav(): DefaultTheme.NavItem[] {
  return [
    { text: "内存管理", link: "/mm", activeMatch: "/mm/" },
    { text: "网络", link: "/net", activeMatch: "/net/" },
    { text: "存储", link: "/storage", activeMatch: "/storage/" },
    {
      text: "进程",
      link: "/process",
      activeMatch: "/process/",
    },
    {
      text: "中断",
      link: "/irq",
      activeMatch: "/irq/",
    },
    {
      text: "调试",
      link: "/debug",
      activeMatch: "/debug/",
    },
    {
      text: "虚拟化",
      link: "/virtualization",
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
      text: "内存管理概述",
      link: "index",
    },
    {
      text: "🚧 《Understanding the Linux Virtual Memory Manager》Linux 2.6",
      link: "gorman_book",
    },
    {
      text: "描述物理内存",
      collapsed: false,
      items: [
        { text: "e820", link: "e820" },
        { text: "node", link: "node" },
        { text: "🚧 struct page", link: "page" },
        { text: "🚧 struct folio", link: "folio" },
        { text: "🚧 page fault", link: "pagefault" },
      ],
    },
    {
      text: "内存映射",
      collapsed: false,
      items: [
        { text: "🚧 page table", link: "page_table" },
        { text: "🚧 mmap", link: "mmap" },
        { text: "🚧 反响映射 rmap", link: "rmap" },
        { text: "🚧 ioremap", link: "ioremap" },
        { text: "🚧 fixmap", link: "fixmap" },
        { text: "🚧 高端内存 highmem", link: "highmem" },
      ],
    },
    {
      text: "内存分配",
      collapsed: false,
      items: [
        { text: "🚧 GFP (Get Free Page)", link: "gfp" },
        { text: "🚧 早期内存分配器 memblock", link: "memblock" },
        { text: "🚧 SLUB 内存分配器", link: "SLUB" },
        { text: "🚧 伙伴系统 buddy system", link: "buddy" },
        { text: "🚧 CMA 连续内存分配", link: "cma" },
        { text: "🚧 页面回收和交换", link: "swap" },
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
      text: "TCP/IP",
      collapsed: false,
      items: [
        { text: "收包流程", link: "rx" },
        { text: "发包流程", link: "tx" },
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
