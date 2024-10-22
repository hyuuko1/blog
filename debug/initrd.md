# initrd 制作

```bash
#!/bin/sh

mount -t devtmpfs dev /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t tmpfs none /tmp
mount -t debugfs none /sys/kernel/debug

UPTIME=$(cut -d' ' -f1 /proc/uptime)

printf \\x1bc
dmesg

echo "Boot took $UPTIME seconds"

/sbin/getty -n -l /bin/sh 115200 /dev/console

poweroff -f
```
