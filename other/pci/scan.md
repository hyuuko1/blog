# BAR (Base Address Registers)

- [PCIe BAR 空间的值是谁设置的？谁分配的，什么时间分配的？ - River008 - 博客园](https://www.cnblogs.com/River-blog/p/18248310)
- [（三）总线设备驱动模型 之 PCIe 内核初始化 - 知乎](https://zhuanlan.zhihu.com/p/708226462)
- [PCIe 学习笔记之 pcie 初始化枚举和资源分配流程代码分析](https://blog.csdn.net/yhb1047818384/article/details/106676548)
- [Linux 内核(13) - 子系统的初始化之以 PCI 子系统为例 - AlanTu - 博客园](https://www.cnblogs.com/alantu2018/p/8448816.html)
- [Linux 内核笔记之 PCIe hotplug 介绍及代码分析](https://blog.csdn.net/yhb1047818384/article/details/99705972)
- [PCIe 设备扫描原理](https://blog.csdn.net/yhb1047818384/article/details/71076371)
- [PCIe 学习笔记之 pcie 结构和配置空间](https://blog.csdn.net/yhb1047818384/article/details/106676528)
- [PCIe 学习笔记之 MSI/MSI-x 中断及代码分析](https://blog.csdn.net/yhb1047818384/article/details/106676560)
- https://chat.qwen.ai/s/362fe69a-15ca-460d-81be-f299f0a3c830?fev=0.0.106
- [7.PCIE 配置空间读写软件\_工具对 pcie 配置空间的读写-CSDN 博客](https://blog.csdn.net/star871016/article/details/119775483)
- [【PCI】PCIe 配置空间访问（九）\_pcie ecam-CSDN 博客](https://blog.csdn.net/zz2633105/article/details/138060829)

BAR 的值在 BIOS 里就设置好了。
可以在 Linux 中修改。

```bash
~ # find /sys -name "*acpi*"
/sys/kernel/debug/acpi
/sys/bus/platform/drivers/acpi-fan
/sys/bus/platform/drivers/acpi-wmi
/sys/bus/platform/drivers/acpi-ged
/sys/bus/acpi
/sys/firmware/qemu_fw_cfg/by_name/etc/acpi
/sys/firmware/acpi
/sys/module/rtc_cmos/parameters/use_acpi_alarm
/sys/module/acpi_cpufreq
/sys/module/acpi_cpufreq/parameters/acpi_pstate_strict
/sys/module/acpiphp_ibm
/sys/module/pci_hotplug/parameters/debug_acpi
/sys/module/nvme/parameters/noacpi
/sys/module/acpiphp
/sys/module/acpi
/sys/module/acpi/parameters/acpica_version
/sys/module/acpi_x86

#

/sys/bus/pci/
/sys/bus/pci_express/

/sys/class/pci_bus/
```

初始化

```cpp
/* 注册 pci bus 和 pcie_port bus */
postcore_initcall(pci_driver_init);
/* 注册 pci_bus class */
postcore_initcall(pcibus_class_init);
/*  */
postcore_initcall(amd_postcore_init);

arch_initcall(pci_arch_init);
arch_initcall(acpi_pci_init);

subsys_initcall(pci_slot_init);
subsys_initcall(pnp_init);
subsys_initcall(acpi_init);
subsys_initcall(pci_subsys_init);

fs_initcall(acpi_event_init);
fs_initcall(pnpacpi_init);
fs_initcall(init_acpi_pm_clocksource);
fs_initcall(pcibios_assign_resources);

fs_initcall_sync(pci_apply_final_quirks);
fs_initcall_sync(acpi_reserve_resources);

rootfs_initcall(pci_iommu_init);

device_initcall(pci_proc_init);
device_initcall(pcie_portdrv_init);
device_initcall(pci_hotplug_init);
device_initcall(mrrm_init);

late_initcall(pci_resource_alignment_sysfs_init);
late_initcall(pci_sysfs_init);
late_initcall(pci_mmcfg_late_insert_resources);
late_initcall(hpet_insert_resource);
```

```cpp
setup_arch()
  acpi_boot_init()
    acpi_process_madt()
      acpi_set_irq_model_ioapic();
    x86_init.pci.init = pci_acpi_init;

```

```cpp
ret_from_fork_asm()
ret_from_fork()
kernel_init()
kernel_init_freeable()
do_initcalls()
do_initcall_level()
do_one_initcall()


subsys_initcall(acpi_init);
acpi_init()
acpi_scan_init()
acpi_bus_scan()
acpi_bus_attach()
acpi_dev_for_each_child()
device_for_each_child()
acpi_bus_attach()
acpi_dev_for_each_child()
device_for_each_child()
acpi_bus_attach()
acpi_scan_attach_handler()
acpi_pci_root_add()
pci_acpi_scan_root()
acpi_pci_root_create()
  pci_acpi_root_add_resources()
    if (res->flags & IORESOURCE_MEM) root = &iomem_resource;
    else if (res->flags & IORESOURCE_IO) root = &ioport_resource;
    insert_resource_conflict(root)
      __insert_resource()
  /* 扫描 pci bus */
  pci_scan_child_bus()->pci_scan_child_bus_extend()
    for (devfn = 0; devfn < 256; devfn += 8)
      pci_scan_slot()


pci_scan_single_device()
pci_scan_device()
pci_setup_device()
pci_read_bases()
  /* 读取大小 */
  __pci_size_stdbars()->__pci_size_bars()
    u32 mask = PCI_ROM_ADDRESS_MASK;
    /* 保存原先的值 */
    pci_read_config_dword(dev, pos, &orig);
    /* 写 1 */
    pci_write_config_dword(dev, pos, mask);
    /* 读取到大小 */
    pci_read_config_dword(dev, pos, sizes);
    /* 恢复原先的值 */
    pci_write_config_dword(dev, pos, orig);
  /*  */
  for (pos = 0; pos < howmany; pos++)
    struct resource *res = &dev->resource[pos];
    reg = PCI_BASE_ADDRESS_0 + (pos << 2);
    pos += __pci_read_base(dev, pci_bar_unknown, res, reg, &stdbars[pos]);
      res->flags = decode_bar(dev, l);
      /*  */
      pcibios_bus_to_resource(dev->bus, res, &region);
      pcibios_resource_to_bus(dev->bus, &inverted_region, res);
```

insert_resource(&iomem_resource, )

/proc/iomem 里的就是 iomem_resource 里的内容。

```cpp
pci_subsys_init()
  pci_acpi_init()
    pr_info("Using ACPI for IRQ routing\n");
```
