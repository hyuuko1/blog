- [iMacCoder/GitHubPages/geek*crawler-1/趣谈 Linux 操作系统/58 * cgroup 技术：内部创业公司应该独立核算成本.md at main · AndersonHJB/iMacCoder](https://github.com/AndersonHJB/iMacCoder/blob/main/GitHubPages/geek_crawler-1/%E8%B6%A3%E8%B0%88Linux%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F/58%20_%20cgroup%E6%8A%80%E6%9C%AF%EF%BC%9A%E5%86%85%E9%83%A8%E5%88%9B%E4%B8%9A%E5%85%AC%E5%8F%B8%E5%BA%94%E8%AF%A5%E7%8B%AC%E7%AB%8B%E6%A0%B8%E7%AE%97%E6%88%90%E6%9C%AC.md)

##

- “Group” (组织和管理): 它的核心思想是将进程“分组”。你可以创建一个组，把一个或多个进程放进去。这个组就是一个管理单元。
- “Control” (限制、记录、隔离): 一旦进程被分组，你就可以对这个“组”作为一个整体，施加资源控制策略。例如，限制这个组总共只能使用 1 个 CPU 核心，或者最多使用 512MB 内存。

```bash
[root@localhost cgroup]# mount | grep cgroup
cgroup2 on /sys/fs/cgroup type cgroup2 (rw,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot)
[root@localhost cgroup]# cd /sys/fs/cgroup
[root@localhost cgroup]# cat cgroup.controllers
cpuset cpu io memory hugetlb pids rdma misc
# 控制子树能够使用的 controllers
[root@localhost cgroup]# cat cgroup.subtree_control
cpu memory pids
```

- cpu 控制器决定一个 cgroup 能用多少 CPU 时间（how much）。
- cpuset 控制器决定一个 cgroup 能在哪些 CPU 上运行（where）。

## 一些代码

kernel/cgroup/cgroup.c

---

include/linux/cgroup_subsys.h 里的内容被用于 `#include <linux/cgroup_subsys.h>` 定义各种变量，

如何快速找到这些 subsys ？搜索
`struct cgroup_subsys.*_cgrp_subsys`
`struct cgroup_subsys_state\s*css`

## cgroup2 fs

```cpp
static struct file_system_type cgroup2_fs_type = {
	.name			= "cgroup2",
	.init_fs_context	= cgroup_init_fs_context,
	.parameters		= cgroup2_fs_parameters,
	.kill_sb		= cgroup_kill_sb,
	.fs_flags		= FS_USERNS_MOUNT,
};
```

## 数据结构

**理清这几个数据结构之间的关系**

- struct cgroup_subsys
  - 假设为 M 个。
  - 例子：
    - memory_cgrp_subsys
    - cpu_cgrp_subsys
    - cpuacct_cgrp_subsys
  - 各种钩子
    - css_alloc
    - css_online
    - attach
    - ...
- struct cgroup
  - 假设为 N 个。
  - 在 /sys/fs/cgroup 里 mkdir 一次，就会创建一个 struct cgroup
- struct cgroup_subsys_state
  - 最多存在 M x N 个。
  - 是基类，子类有：struct mem_cgroup; struct task_group; 等等

```cpp
cgroup_mkdir()
  /* 创建 struct cgroup */
  cgroup_create()
  cgroup_apply_control_enable()->css_create()
    /* 为各种 cgroup_subsys 进行创建 css 并与 cgroup 进行 link */
    init_and_link_css()
```
