- Intel SDM Volume 3. CHAPTER 12 ADVANCED PROGRAMMABLE INTERRUPT CONTROLLER (APIC)
  https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html
- [APIC: Advanced Programmable Interrupt Controller 高级可编程中断控制器总结](https://www.cnblogs.com/wudibuzaijia/p/8548349.html)
- [APIC | Kernel Exploring](https://richardweiyang-2.gitbook.io/kernel-exploring/00-start_from_hardware/06-apic#ying-jian-gui-fan)
- [X86 中断/异常与 APIC](https://www.cnblogs.com/wsg1100/p/14055863.html)

##

acpi 和 apic 的关系
https://chat.qwen.ai/s/36155b1b-fc02-48ce-899f-e99166abcb7c?fev=0.0.106

- ACPI 是操作系统用来获取系统硬件信息（包括 APIC 配置）的一种方式 。
- APIC 是实现中断控制的实际硬件模块 。
- 在启动时，操作系统会通过 ACPI 表格（如 MADT - Multiple APIC Description Table）来发现和初始化 APIC 控制器。
- 所以说，ACPI 提供了关于 APIC 的配置信息，而 APIC 实现了中断处理的功能 。
