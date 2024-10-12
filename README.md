## Vercel

https://vercel.com/

建议把博客托管在 Vercel 上面，和 GitHub Pages 一样的每月 100G 带宽限制，但管理起来更方便，一键部署，有数据统计等等各种功能。个人版免费，加钱支持团队协作。

## 模板

https://vercel.com/docs/frameworks

比较好看的有：

- VitePress https://vitepress.dev/zh/
  专门用来写文档用的，中文搜索的支持很好。
- Next.js https://nextjs.org/
  这个更全能，用来写文档也太复杂了。。。

## 本地部署

https://vercel.com/docs/deployments/local-env

```bash
# 安装到了 ~/.local/share/fnm/node-versions/v20.17.0/installation/bin/
npm install -g vercel
# 安装 package.json 里的所有依赖
npm install

# https://vercel.com/docs/cli
vercel dev
```

`.vercelignore`

`.env.local`

vercel.json
https://vercel.com/docs/projects/project-configuration

## VitePress

https://vitepress.dev/zh/

```bash
# -D 表明是开发环境下的依赖
❯ npm add -D vitepress
# 修改 package.json 后，更新依赖
❯ npm update -D vitepress


❯ npx vitepress init

┌  Welcome to VitePress!
│
◇  Where should VitePress initialize the config?
│  ./
│
◇  Site title:
│  Blog
│
◇  Site description:
│  My Blog
│
◇  Theme:
│  Default Theme
│
◇  Use TypeScript for config and theme files?
│  Yes
│
◇  Add VitePress npm scripts to package.json?
│  Yes
│
└  Done! Now run npm run docs:dev and start writing.

Tips:
- Make sure to add .vitepress/dist and .vitepress/cache to your .gitignore file.

❯ npm run docs:dev

> docs:dev
> vitepress dev


  vitepress v1.3.4

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h to show help

```

HTTP 缓存标头
https://vitepress.dev/zh/guide/deploy#http-cache-headers
https://vercel.com/docs/concepts/projects/project-configuration#headers

##

在同一目录管理多个项目
https://vercel.com/docs/monorepos

## TODO

https://vercel.com/integrations/slack/new
