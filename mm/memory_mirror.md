# Memory Mirror

- [\[PATCH v4 0/2\] mm: Introduce kernelcore=mirror option - Taku Izumi](https://lore.kernel.org/lkml/1452241523-19559-1-git-send-email-izumi.taku@jp.fujitsu.com/)
- [Address Range Memory Mirroring](https://events.static.linuxfound.org/sites/events/files/slides/Address%20Range%20Memory%20Mirroring-RC.pdf)

```
kernelcore=mirror
```

内存镜像是内存冗余技术的一种，是为了提高服务器的可靠性，防止内存故障导致服务器的数据永久丢失或者系统宕机。内存镜像的工作原理与硬盘的热备份类似，内存镜像是将内存数据做两个拷贝，分别放在主内存和镜像内存中。系统工作时会向两个内存中同时写入数据，因此使得内存数据有两套完整的备份。
