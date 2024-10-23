# ACPI

- [acpid - Arch Linux 中文维基](https://wiki.archlinuxcn.org/wiki/Acpid)

virsh shutdown 需要虚拟机启动了 acpid 或 systemd-logind。

acpid 需要在 `/etc/acpi/events/` 创建一个配置文件

```conf
event=button/power
action=/sbin/poweroff -f
```

- [ ] poweroff 命令的原理。
  - 待确认：不加 -f 选项时，会与 init 进程交互？让 init 进程退出完成关机？
  - 加 -f 选项时，会强行发送一个 ACPI 信号来通知系统关机？
