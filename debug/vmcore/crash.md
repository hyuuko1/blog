# crash

- 🌟[朴英敏:用 crash 工具分析 Linux 内核死锁的一次实战](https://blog.csdn.net/21cnbao/article/details/103607644)
- [crash 常用命令讲解](https://blog.csdn.net/linux_research/article/details/135833395)
- [【调试】crash 使用方法](https://www.cnblogs.com/dongxb/p/17364995.html)
- [crash-utility.github.io/help.html](https://crash-utility.github.io/help.html)
- [crash-utility.github.io/crash_whitepaper.html](https://crash-utility.github.io/crash_whitepaper.html)

## 查看线程组内的所有线程

```bash
ps -g PID

list task_struct.thread_node -s task_struct.comm,pid -h ffff88012b98e040
```
