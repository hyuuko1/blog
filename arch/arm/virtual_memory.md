# AArch64 虚拟内存系统架构

## 参考

- [ARM Cortex-A Series Programmer's Guide for ARMv8-A](https://cs140e.sergio.bz/docs/ARMv8-A-Programmer-Guide.pdf)
  Chapter 12 The Memory Management Unit
- [Arm Architecture Reference Manual for A-profile architecture](https://developer.arm.com/documentation/ddi0487/latest)
  Chapter D8 The AArch64 Virtual Memory System Architecture

## D8.1 Address translation

ARMv8-A 架构的虚拟化扩展引入了第 2 个转换阶段。

1. stage 1 是 VA->IPA
2. stage 2 是 IPA->PA

**本文不涉及虚拟化内容，默认 stage 1**

## D8.3 Translation table descriptor formats

Table D8-48 定义了描述符类型

- Table descriptor 描述了一个 table
- Page descriptor 描述了一个页面，比如 4KB 这种。
- Block descriptor 描述了一个大页面，比如 2MB 这种。

## D8.4 Memory access control

- Direct permissions 模式，使用描述符里定义的 access permissions。
- Indirect permissions 模式，使用描述符里定义的 Permission Indirection Index。
  <br>Permission Indirection Extension (PIE) 是在 Armv8.9-A/Armv9.4-A 引入的。
  <br>在 2023.6 合入的 patchset 让 Linux 支持了 https://lore.kernel.org/all/20230606145859.697944-1-joey.gouly@arm.com/ [Linux 6.5 On AArch64 Sees New Extensions, KPTI Cleanup - Phoronix](https://www.phoronix.com/news/Linux-6.5-ARM64) [Arm A-Profile 构架 2022 扩展](https://aijishu.com/a/1060000000360623)
  <br>如果 cpu 不支持此特性，会 `cbz	x1, .Lskip_indirection` 跳过启用 PIE。

**懒得研究这玩意，本文默认 Direct permissions**

## D8.5 Hardware updates to the translation tables

> 来自：ARMv8-A-Programmer-Guide.pdf 12.8 Operating system use of translation table descriptors
>
> Operating systems use an access flag bit to keep track of which pages are being used. Software manages the flag. When the page is first created, its entry has AF set to 0. The first time the page is accessed by code, if it has AF at 0, this triggers an MMU fault. The Page fault handler records that this page is now being used and manually sets the AF bit in the table entry. For example, the Linux kernel uses the [AF] bit for `PTE_AF` on ARM64 (the Linux kernel name for AArch64), which is used to check whether a page has ever been accessed. This influences some of the kernel memory management choices. For example, when a page must be swapped out of memory, it is less likely to swap out pages that are being actively used.
>
> Bits [58:55] of the descriptor are marked as _Reserved for Software Use_ and can be used to record OS-specific information in the translation tables. For example, the Linux kernel uses one of these bits to mark an entry as clean or dirty. The dirty status records whether the page has been written to. If the page is later swapped out of memory, a clean page can simply be discarded, but a dirty page must have its contents saved first.

### D8.5.1 The Access flag

If the AF is not managed by hardware, software management of the AF is required.

For an implementation that does not manage the AF in hardware, when an attempt is made to translate an address using a descriptor with an AF of 0, an Access flag fault is generated.
For an implementation that does not manage the AF in hardware, when an Access flag fault is generated, software is expected to set the AF to 1 in the descriptor that generated the fault.
Setting the AF to 1 prevents the Access flag fault from being generated the next time an attempt is made to translate an address using that descriptor.
When software sets the AF to 1, there is no requirement to perform TLB invalidation after setting the flag because entries with an AF set to 0 are never held in a TLB.

在 Linux 中，`handle_pte_fault()` 会 `pte_mkyoung()` 置上 Access flag，详见 [pagefault](../../mm/pagefault.md)。

### D8.5.2 The dirty state

dirty state 用于表示内存页面已经被修改。

一个 Block/Page 描述符，有下列几种状态之一：

- Non-writable
- Writable-clean
- Writable-dirty

如果一个翻译阶段使用 Direct permission，那么只允许硬件管理 dirty state；
如果一个翻译阶段使用 Indirect permission，那么允许软件或硬件管理 dirty state。
如果描述符的 dirty state 被软件管理（即，禁用了硬件管理），那么对于 writable-clean 描述符翻译的 write accesses，会由于 dirty state 而生成 Permission fault。
XXX 难道：如果用 Direct permission，因为只允许硬件管理不允许软件管理，所以不会因为 dirty state 生成 Permission fault？这不对吧？？是我的理解有问题？

#### D8.5.2.1 Hardware management of the dirty state

`FEAT_HAFDBS` 特性支持硬件更新 Access flag 和 dirty state.

将 `TCR_ELx.HD` 置 1 启用了硬件管理 dirty state。

对于使用 Direct permission 的翻译，当 Block/Page 描述符的 DBM field 为 0 时：

- Permission faults 的生成不会被 `FEAT_HAFDBS` 所影响。
- 硬件不会更新该页面的 dirty state。

对于使用 Direct permission 的每个翻译阶段，如果下列条件成立，那么该 Block/Page 描述符是 writable-clean 的：

- 启用了硬件更新 dirty state
- 描述符的 DBM field 是 1
- 对于 stage 1，描述符的 AP[2] 是 1（表示只读）。注意：如果禁用了硬件管理 dirty state，那么 write access 发生 Permission fault 的原因只有一个：AP[2] 是 1。

对于使用 Direct permission 的每个翻译阶段，如果下列条件成立，那么该 Block/Page 描述符是 writable-dirty 的：

- 启用了硬件更新 dirty state
- 描述符的 DBM field 是 1
- 对于 stage 1，描述符的 AP[2] 是 0（表示可读写）

只有当描述符是 writable-clean 的时，硬件才能更新 dirty state。

对于被一个 writable-clean 翻译的 write access：

- 如果描述符的 dirty state 被硬件管理，那么不会生成 Permission fault，并且硬件会使用 atomic read-modify-write 更新描述符为 writable-dirty（也就是把 AP[2] 置 0）。如果满足更新 Access flag 的条件，也会顺便置 1。
- 由该 write access 而产生 Permission fault 的唯一原因是：dirty state 硬件管理被禁用。

#### 在 Linux 内核中的体现

[How does ARM Linux emulate the dirty, accessed, and file bits of a PTE? - Stack Overflow](https://stackoverflow.com/questions/32943129/how-does-arm-linux-emulate-the-dirty-accessed-and-file-bits-of-a-pte)

对于一个可写的页面，Linux 会将描述符的 DBM field 置 1，将 RDONLY field 也置 1，表示该描述符是 writable-clean 的。

- 当启用硬件管理 Access flag 和 dirty state 时。发生 write access，硬件会将 Access flag 置 1（如果是第一次访问），并且将 RDONLY field 置清 0，使得描述符从 writable-clean 变为 writable-dirty。
- 当禁用硬件管理 Access flag 和 dirty state 时。发生 write access，由于是 writable-clean 的（DBM 是 1，RDONLY 是 1），因此会发生 Permission fault，Linux 会在 `handle_pte_fault()` 函数中，先 `pte_mkdirty()` 将软件定义的 DIRTY field 置 1，并将 RDONLY field 清 0，然后 `pte_mkyoung()` 将 Access flag 置 1（如果是第一次访问）。

`handle_pte_fault()` 函数详见 [pagefault](../../mm/pagefault.md)。

```cpp
/* arch/arm64/include/asm/pgtable-prot.h */
/* 软件定义的 WRITE field，实际上就是 DBM field */
#define PTE_WRITE		(PTE_DBM)
/* 软件定义的脏位。使用的是一个 IGNORED field  */
#define PTE_DIRTY		(_AT(pteval_t, 1) << 55)

/* DBM field 为 1，表示 writable */
#define pte_write(pte)		(!!(pte_val(pte) & PTE_WRITE))
/* RDONLY field 为 1，表示 read-only */
#define pte_rdonly(pte)		(!!(pte_val(pte) & PTE_RDONLY))

/* DBM 是 1，AP[2] 是 0，表示 writable-dirty */
#define pte_hw_dirty(pte)	(pte_write(pte) && !pte_rdonly(pte))
/* 软件定义的脏位为 1 */
#define pte_sw_dirty(pte)	(!!(pte_val(pte) & PTE_DIRTY))
#define pte_dirty(pte)		(pte_sw_dirty(pte) || pte_hw_dirty(pte))

static inline pte_t pte_mkdirty(pte_t pte)
{
	/* 软件定义的 DIRTY field 置 1 */
	pte = set_pte_bit(pte, __pgprot(PTE_DIRTY));
	/* 将 RDONLY field 清 0 */
	if (pte_write(pte))
		pte = clear_pte_bit(pte, __pgprot(PTE_RDONLY));
	return pte;
}

static inline pte_t pte_mkyoung(pte_t pte)
{
	/* 将 Access flag 置 1 */
	return set_pte_bit(pte, __pgprot(PTE_AF));
}
```

**`FEAT_HAFDBS` 特性的启用**

```c
/* arch/arm64/Kconfig */
config ARM64_HW_AFDBM
	bool "Support for hardware updates of the Access and Dirty page flags"
	default y
	help
	  The ARMv8.1 architecture extensions introduce support for
	  hardware updates of the access and dirty information in page
	  table entries. When enabled in TCR_EL1 (HA and HD bits) on
	  capable processors, accesses to pages with PTE_AF cleared will
	  set this bit instead of raising an access flag fault.
	  Similarly, writes to read-only pages with the DBM bit set will
	  clear the read-only bit (AP[2]) instead of raising a
	  permission fault.

	  Kernels built with this configuration option enabled continue
	  to work on pre-ARMv8.1 hardware and the performance impact is
	  minimal. If unsure, say Y.

/* arch/arm64/include/asm/pgtable-hwdef.h */
#define TCR_HA			(UL(1) << 39)
#define TCR_HD			(UL(1) << 40)

/* 在 bootting 阶段，cpu_enable 钩子会被调用  */
static const struct arm64_cpu_capabilities arm64_features[] = {
#ifdef CONFIG_ARM64_HW_AFDBM
	{
		.desc = "Hardware dirty bit management",
		.type = ARM64_CPUCAP_WEAK_LOCAL_CPU_FEATURE,
		.capability = ARM64_HW_DBM,
		.matches = has_hw_dbm,
		.cpu_enable = cpu_enable_hw_dbm,
		.cpus = &dbm_cpus,
		ARM64_CPUID_FIELDS(ID_AA64MMFR1_EL1, HAFDBS, DBM)
	},
#endif
}
cpu_enable_hw_dbm()
  if (cpu_can_use_dbm(cap))
    __cpu_enable_hw_dbm();
      /* 给 TCR_EL1 寄存器的 TCR_HD bit 置位 */
      u64 tcr = read_sysreg(tcr_el1) | TCR_HD;
      write_sysreg(tcr, tcr_el1);

/* __cpu_setup 函数 */
SYM_FUNC_START(__cpu_setup)
...
#ifdef CONFIG_ARM64_HW_AFDBM
...
	/* 给 TCR_EL1 寄存器的 TCR_HA bit 置位 */
	orr	tcr, tcr, #TCR_HA
```

#### D8.5.2.3 Hardware dirty state tracking structure

持续记录 dirtied stage 2 的 Block/Page 描述符，使得 EL2 的 Hypervisor 无需扫描页表。

## D8.15 Memory aborts

### D8.15.1 MMU fault types

#### D8.15.1.4 Access flag fault

### D8.15.5 MMU fault prioritization from a single address translation stage
