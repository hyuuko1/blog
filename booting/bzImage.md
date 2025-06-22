- [启动镜像 bzImage 的前世今生 | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/00_index/07_rules_for_bzimage)
- [Linux 内核格式与启动协议](https://jia.je/os/2023/10/01/linux-boot-protocol/#linuxx86-boot-protocol)

bzImage 文件的 0x1f1 偏移处是 `struct boot_params` 里的 `struct setup_header hdr;`
