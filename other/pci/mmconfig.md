# PCIe 配置空间访问

## 参考

- 《PCI Express 体系结构导读》
  14.1.2 pci_arch_init 函数

##

PCI Express 配置模型支持两种配置空间访问机制：

- PCI-compatible Configuration Access Mechanism(CAM，PCI 兼容配置访问机制，参见协议第 7.2.1 节)
- PCI Express Enhanced Configuration Access Mechanism(ECAM，PCI Express 增强型配置访问机制，参见协议第 7.2.2 节)

CAM 模式是 PCI 协议定义的访问方式，而 ECAM 则是 PCIe 协议定义的访问方式。为了兼容传统 PCI 设备，PCIe 协议要求 ECMA 机制与 CAM 机制访问配置空间前 256 byte 等效。

以 x86 为例，X86 处理器定义了两个 I/O 端口寄存器，分别为 CONFIG_ADDRESS 何 CONFIG_DATA 寄存器，地址为 `0xCF8` 和 `0xCFC`，CAM 访问机制就是通过这两个寄存器实现的。简单来说就是把需要访问的 PCI 设备信息按特定格式写入 CONFIG_ADDRESS 寄存器，然后读写 CONFIG_DATA 寄存器即可。

```bash
$ grep conf /proc/ioports
0cf8-0cff : PCI conf1

# 注意，
在旧版的内核上，是 MMCONFIG 而非 ECAM
$ grep ECAM /proc/iomem
b0000000-bfffffff : PCI ECAM 0000 [bus 00-ff]
```

```cpp
pci_conf1_read

pci_conf2_read

pci_mmcfg_read


struct pci_ops pci_root_ops = {
	.read = pci_read,
	.write = pci_write,
};
static int pci_read(struct pci_bus *bus, unsigned int devfn, int where, int size, u32 *value)
{
	return raw_pci_read(pci_domain_nr(bus), bus->number,
				 devfn, where, size, value);
}
int raw_pci_read(unsigned int domain, unsigned int bus, unsigned int devfn,
						int reg, int len, u32 *val)
{
	if (domain == 0 && reg < 256 && raw_pci_ops)
		/* pci_conf1_read */
		return raw_pci_ops->read(domain, bus, devfn, reg, len, val);
	if (raw_pci_ext_ops)
		/* pci_mmcfg_read */
		return raw_pci_ext_ops->read(domain, bus, devfn, reg, len, val);
	return -EINVAL;
}

/* arch/x86/pci/direct.c */
raw_pci_ops = &pci_direct_conf1;
/* arch/x86/pci/mmconfig_64.c */
raw_pci_ext_ops = &pci_mmcfg;

pci_mmcfg_read()
  addr = pci_dev_base(seg, bus, devfn);
    /* 查找 struct pci_mmcfg_region */
    struct pci_mmcfg_region *cfg = pci_mmconfig_lookup(seg, bus);
    cfg->virt + (PCI_MMCFG_BUS_OFFSET(bus) | (devfn << 12));

/* struct pci_mmcfg_region 的添加流程 */
pci_arch_init()
  pci_mmcfg_early_init();
    acpi_table_parse(ACPI_SIG_MCFG, pci_parse_mcfg);
      pci_parse_mcfg()
        pci_mmconfig_add()
	  list_add_sorted()
```
