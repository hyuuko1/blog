# TODO List

- [ ] poweroff 命令的原理。
  - 待确认：不加 -f 选项时，会与 init 进程交互？让 init 进程退出完成关机？
  - 加 -f 选项时，会强行发送一个 ACPI 信号来通知系统关机？
  - https://unix.stackexchange.com/a/501115
  ```conf
  event=button/power
  action=/sbin/poweroff -f
  ```
- [ ] 优化案例。
      [Linux 内存管理中锁使用分析及典型优化案例总结-CSDN 博客](https://blog.csdn.net/feelabclihu/article/details/141087096)
- [ ] RCU [【原创】Linux RCU 原理剖析（二）-渐入佳境 - LoyenWang - 博客园](https://www.cnblogs.com/LoyenWang/p/12770878.html)
