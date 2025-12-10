# Page Table

- https://github.com/freelancer-leon/notes/blob/master/kernel/mm/mm_pagetable.md

##

|    字段     |            描述             |      位数      |
| :---------: | :-------------------------: | :------------: |
|     cr3     |        指向一个 PDPT        | crs 寄存器存储 |
|     PGD     | 指向 PDPT 中 4 个项中的一个 |    位 31~30    |
|     PMD     | 指向页目录中 512 项中的一个 |    位 29~21    |
|     PTE     |  指向页表中 512 项中的一个  |    位 20~12    |
| page offset |       4KB 页中的偏移        |    位 11~0     |

在 Linux 内核中，`pgd`、`p4d`、`pud`、`pmd` 和 `pte` 是内存管理模块中用于描述**多级页表结构**的术语。它们共同完成虚拟地址到物理地址的转换，是分页机制（Paging）的核心组成部分。

---

### **1. 背景：多级页表的意义**

x86 架构（和其他现代 CPU）通过**多级页表**将虚拟地址（Virtual Address）转换为物理地址（Physical Address）。这种设计：

- **节省内存**：稀疏地址空间无需分配完整的页表。
- **灵活控制权限**：每级页表可设置访问权限（读/写/执行）。
- **支持大地址空间**：例如，64 位系统需要多级分页管理巨大地址空间。

Linux 内核根据硬件特性（如是否启用 5 级分页）动态调整页表层级。

---

### **2. 页表层级术语**

以下是各级页表的含义及其作用：

| 缩写 | 全称                     | 作用                                         | 对应硬件层级 |
| ---- | ------------------------ | -------------------------------------------- | ------------ |
| PGD  | Page Global Directory    | 顶级页表，指向下一级页表（P4D 或 PUD）       | 第 4/5 级    |
| P4D  | Page 4th-level Directory | 用于扩展传统四级分页到五级（可选）           | 第 4 级      |
| PUD  | Page Upper Directory     | 上层页表，指向下一级页表（PMD）              | 第 3 级      |
| PMD  | Page Middle Directory    | 中间层页表，指向下一级页表（PTE）            | 第 2 级      |
| PTE  | Page Table Entry         | 最底层页表，直接映射到物理页帧（Page Frame） | 第 1 级      |

在内核代码中的常见的变量 `pgd` 指向 pgd 页表中的其中一个 entry，要么指向一整个 pgd 页表（也就是指向页表中的第一个 entry）。其他的 p4d pud 等一样依次类推。

---

### **3. 虚拟地址的分解**

虚拟地址被拆解为多个字段，每级页表负责解析一部分：

4 级分页，48-bit 256TB

| 63-48 | 47-39 | 38-30 | 29-21 | 20-12 | 11-0   |
| ----- | ----- | ----- | ----- | ----- | ------ |
| Sign  | PGD   | PUD   | PMD   | PTE   | Offset |
|       | 512GB | 1GB   | 2MB   | 4KB   |        |

5 级分页，57-bit 128PB

| 63-57 | 56-48 | 47-39 | 38-30 | 29-21 | 20-12 | 11-0   |
| ----- | ----- | ----- | ----- | ----- | ----- | ------ |
| Sign  | PGD   | P4D   | PUD   | PMD   | PTE   | Offset |
|       | 256TB | 512GB | 1GB   | 2MB   | 4KB   |        |

### **4. 内核中的实现**

#### **数据结构**

- 每个页表层级对应一个内核结构体：
  ```c
  typedef struct { pgdval_t pgd; } pgd_t;      // PGD条目
  typedef struct { p4dval_t p4d; } p4d_t;      // P4D条目
  typedef struct { pudval_t pud; } pud_t;      // PUD条目
  typedef struct { pmdval_t pmd; } pmd_t;      // PMD条目
  typedef struct { pteval_t pte; } pte_t;      // PTE条目
  ```
- 页表项包含物理地址和权限标志（如`_PAGE_PRESENT`、`_PAGE_RW`）。

#### **地址转换流程**

虚拟地址转换的代码逻辑（简化）：

```c
pgd_t *pgd = pgd_offset(mm, address);         // 获取 PGD 条目
p4d_t *p4d = p4d_offset(pgd, address);        // 获取 P4D 条目（若启用）
pud_t *pud = pud_offset(p4d, address);        // 获取 PUD 条目
pmd_t *pmd = pmd_offset(pud, address);        // 获取 PMD 条目
pte_t *pte = pte_offset_map(pmd, address);    // 获取 PTE 条目
phys_addr = pte_pfn(*pte) << PAGE_SHIFT | offset; // 计算物理地址
```

cpu feature `X86_FEATURE_LA57`，
5 级分页在 BIOS/UEFI 中一般默认是禁用的。
如果启用了，可以用 `no5lvl` 启动参数强制用 4 级分页。

如未启用，就将 pgd 作为 p4d：

```cpp
static inline p4d_t *p4d_offset(pgd_t *pgd, unsigned long address)
{
	if (!pgtable_l5_enabled())
		return (p4d_t *)pgd;
	return (p4d_t *)pgd_page_vaddr(*pgd) + p4d_index(address);
}
```

- Intel 正在推动移除 `CONFIG_X86_5LEVEL`，始终启用 5-level paging. [Linux Looking To Make 5-Level Paging Support Unconditional For x86_64 Kernel Builds - Phoronix](https://www.phoronix.com/news/Linux-Unconditional-5-Level-x86)

---

### **5. 五级分页（P4D）的引入**

- **背景**：传统 x86-64 使用 4 级页表（48 位地址空间），但某些场景需要更大地址空间（如 Intel 5-level paging 扩展至 57 位）。
- **P4D 的作用**：在 PGD 和 PUD 之间插入一级页表，支持更大的地址空间。
- **条件编译**：内核通过`CONFIG_PGTABLE_LEVELS`配置分页层级（4 或 5 级）。

---

### **6. 权限与映射**

每级页表项包含控制权限的标志位，例如：

- `_PAGE_PRESENT`：页是否存在于物理内存。
- `_PAGE_RW`：是否可写。
- `_PAGE_USER`：用户态是否可访问。
- `_PAGE_NX`：禁止执行（Data Execution Prevention）。

---

### **总结**

- **PGD/P4D/PUD/PMD/PTE** 是多级页表的层级结构，用于虚拟地址到物理地址的转换。
- **PGD 是顶级页表**，PTE 是最底层直接映射物理页的条目。
- **五级分页（P4D）** 是可选的扩展，用于支持更大地址空间。
- 内核通过条件编译和硬件抽象层（HAL）适配不同架构的分页机制。
