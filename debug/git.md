# Git 常见用法

## ~/.gitconfig

```conf
[user]
email = xxx@xxx.com
name = xxx
[core]
editor = code --wait
abbrev = 12
[commit]
template = ~/.gitmessage

[pretty]
# git -P log --pretty=fixes -1 <commit_id>
fixes = Fixes: %h (\"%s\")

[diff]
# patience 算法，最易读。
algorithm = patience
```

## git log

```bash
# -10 查看该 commit 之前的 10 条 log
# 用了 --reverse 后，则从上往下是时间顺序
git log --oneline --reverse -10 <hash>
# 如果想查看 commit 之后的 10 条 log，建议设置一个大概的时间范围，然后用 / 查找
# 在 linux kernel git 仓使用时，大概要花 5s
git log --oneline --reverse --after="2010-5-1" --before="2010-7-1"
# 直接用 / 搜索某个 commit，没限定时间范围，大概 10s
git log --oneline
# 推荐这样做！保存到放到文件里，而且颜色高亮
script -c 'git -P log --format="%C(magenta)%h %C(blue)%cd %C(default)%s %C(cyan)%aN" --date=short --reverse' /tmp/linux.git.log
grep -30 <commit信息> /path/to/linux.git.log

# 默认用的 --topo-order，易读性较好
git log --graph
# 查看某个文件的历史
git log path/to/file
```

## git blame

```bash

```

## git format-patch

```bash
# 使用 patience diff algorithm
--patience
```
