import { createRequire } from "module";
import { defineConfig } from "vitepress";
import { nav, sidebar } from "./sidebar";

const require = createRequire(import.meta.url);

// https://vitepress.dev/zh/reference/site-config
export default defineConfig({
  title: "Blog",
  lang: "zh-Hans",
  description: "Linux kernel 内核代码分析，原理详解",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/linux.svg" }],
    ["link", { rel: "icon", type: "image/png", href: "/linux-32x32.png" }],
    ["meta", { name: "theme-color", content: "#5f67ee" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "zh_CN" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Linux kernel 内核代码分析",
      },
    ],
    [
      "meta",
      {
        property: "og:site_name",
        content: "Linux kernel 内核代码分析，原理详解",
      },
    ],
    ["meta", { property: "og:url", content: "https://hyuuko.vercel.app" }],

    // 百度 https://ziyuan.baidu.com/site/index
    // google https://search.google.com/search-console?resource_id=https%3A%2F%2Fhyuuko.vercel.app
    [
      "meta",
      {
        name: "google-site-verification",
        content: "OMML6xlbLb2Asitovo85pbOZGTvYoWaYWYW3ps7083s",
      },
    ],
    // bing https://www.bing.com/webmasters?siteUrl=https%3A%2F%2Fhyuuko.vercel.app
    // https://www.bing.com/webmasters/help/webmasters-guidelines-30fba23a
    [
      "meta",
      {
        name: "msvalidate.01",
        content: "E3B108A75866D6C18B16BE35E14DE820",
      },
    ],
  ],
  // head: [['link', { rel: 'icon', href: '/linux-256x256.png' }]],

  transformPageData(pageData) {
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push([
      "meta",
      {
        property: "og:title",
        content:
          pageData.frontmatter.layout === "home"
            ? `Linux kernel 内核代码分析`
            : `${pageData.title} | Blog`,
      },
    ]);
  },

  /* SEO 优化
  https://www.kyoudesu.com/note/vitepress/%E6%8F%90%E5%8D%87%20VitePress%20%E7%B6%B2%E7%AB%99%20SEO%20%E7%9A%84%E5%BB%BA%E8%AD%B0.html
  https://github.com/mqyqingfeng/Blog/issues/279
  https://vitepress.dev/zh/guide/sitemap-generation
  可以参考 nixos-and-flakes-book */
  sitemap: {
    hostname: "https://hyuuko.vercel.app",
    /* transformItems: (items) => {
      return items.map((item) => {
        return Object.assign({}, item, {
          changefreq: "daily",
          priority: 1.0,
        });
      });
    }, */
  },

  // remove trailing `.html`
  // https://vitepress.dev/guide/routing#generating-clean-url
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,

  ignoreDeadLinks: true,

  markdown: {
    config: (md) => {
      md.use(require("markdown-it-footnote"));
      md.use(require("markdown-it-task-lists"));
    },
    // math: true,
    container: {
      tipLabel: "提示",
      warningLabel: "警告",
      dangerLabel: "危险",
      infoLabel: "信息",
      detailsLabel: "详细信息",
    },
    lineNumbers: true,
    image: {
      // 默认禁用图片懒加载
      lazyLoading: true,
    },
  },

  themeConfig: {
    // 左上角标题前面的 logo
    logo: { src: "/linux.svg", width: 20, height: 20 },

    editLink: {
      pattern: "https://github.com/hyuuko1/blog/edit/main/:path",
    },

    // https://vitepress.dev/reference/default-theme-config
    nav: nav(),
    sidebar: sidebar(),

    search: {
      provider: "local",
      options: {
        detailedView: true,
        locales: {
          // 注意这里用 root 而非 zh
          root: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "清除查询条件",
                noResultsText: "无法找到相关结果",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },

    // TODO: 加一个 mailto
    socialLinks: [{ icon: "github", link: "https://github.com/hyuuko1/blog" }],

    footer: {
      message: "Licensed under MIT",
      copyright: `Copyright © 2024-${new Date().getFullYear()} HYUUKO`,
    },

    docFooter: {
      prev: "上一页",
      next: "下一页",
    },

    outline: {
      level: "deep",
      label: "目录",
    },

    lastUpdated: {
      text: "最后更新于",
      formatOptions: {
        dateStyle: "short",
        timeStyle: "medium",
      },
    },

    // 是否在 markdown 中的外部链接旁显示外部链接图标
    externalLinkIcon: true,

    langMenuLabel: "多语言",
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },
});
