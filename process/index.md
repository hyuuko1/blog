# 进程

- [命名空间](../other/namespace/namespace.md)
- 线程组 进程组 会话
- clone
  - 各种 flags
  - 唤醒新进程
  - 运行新进程
- execve
  - 加载程序
  - 二进制格式 linux_binfmt
    - ELF
    - 脚本
- exit() exit_group()
- kill() tgkill()
- waitid() 和 waitpid() 查询终止的子进程
  - 不要被名字迷惑，不是 wait tid, 是 wait id！这个名字和线程无关，waitid() 是比 waitpid() 更现代的一个接口，可以更精细控制等待事件类型。
- 进程状态
