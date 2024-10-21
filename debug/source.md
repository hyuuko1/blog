# Linux 内核源码

```bash
# git history 里不包含 2.6.12-rc2 之前的
# 需下载 3GiB
git clone https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git

# 包含 2.6.12-rc2 到 2.6.33-rc5 之前的 history，共 179995 个 commit
# 673.95 MiB
git clone https://git.kernel.org/pub/scm/linux/kernel/git/history/history.git

# 克隆 linux-2.6.12-rc2 之前的，159.51 MiB
git clone https://github.com/mpe/linux-fullhistory --single-branch -b linux-2.6.12-rc2
```

安装 git lens 扩展，
鼠标放在代码右边，会弹出一个框，点击 Open Changes With Previous Revision，然后一直点，就可以找到最初引入这样代码的 commit 了。
