# 体系结构

- 架构：指令集体系结构（Instruction Set Architecture，简称 ISA），是处理器的一个抽象描述，称为架构。例子：x86, amd64, Armv8-A, Armv9-A。
- 微架构：ISA 在处理器中的实现，被称为 Microarchitecture（微架构）。

目前只记录了一些 ISA 相关的笔记

## x86 文档

- [Intel® 64 and IA-32 Architectures Software Developer Manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
  卷三是系统编程指南，1500 多页。
- [AMD64 Architecture Programmer's Manual Volumes 1–5](https://www.amd.com/content/dam/amd/en/documents/processor-tech-docs/programmer-references/40332.pdf)
  感觉比 intel 的更易懂？卷二是系统编程指南，不到 900 页。
- [80386 Programmer's Reference Manual](https://nju-projectn.github.io/i386-manual/)
  勘误后的 i386-manual

## arm 文档

<https://developer.arm.com/documentation>

必看：[Learn the architecture - Introducing the Arm architecture](https://developer.arm.com/documentation/102404/0201/?lang=en)

- 三种架构 profile：A, R 和 M
  - A-Profile (Applications) 高性能，运行复杂系统，比如 Linux 和 Windows
  - R-Profile (Real-Time) 用于有实时性需求的系统
  - M-Profile (Microcontroller) 用于小的，低功耗的 IoT 设备
- 架构规范分为这几部分：
  - 指令集
  - 寄存器
  - 异常模型
  - 内存模型
  - Debug, trace, and profiling
- 理解 Arm 文档，有个表列出了不同类型的文档里有哪些内容 https://developer.arm.com/documentation/102404/0201/Understanding-Arm-documentation
  - 架构文档：每个 Arm 架构参考手册 Architecture Reference Manual 都描述了一个架构的规范。一个 Arm 架构参考手册与该架构的任何实现都相关。
  - 微架构文档
    - 每个 Arm Cortex 处理器都有一个技术参考手册 Technical Reference Manual (TRM)，描述了特定于该处理器的特性。TRM 不会重复在 Arm 架构参考手册里出现过的信息。
    - 每个 Arm Cortex 处理器还有一个配置和集成手册 Configuration and Integration Manual (CIM)，描述了如何将该处理器集成到一个系统里，只对 SoC 设计者有意义。
- 一些术语：PE、RES0 RES1

https://www.arm.com/architecture/learn-the-architecture
https://www.arm.com/architecture/learn-the-architecture/a-profile
https://developer.arm.com/Architectures 分成了几个专题，比如：

- A-Profile Architecture: https://developer.arm.com/Architectures/A-Profile%20Architecture
- GIC: https://developer.arm.com/Architectures/Generic%20Interrupt%20Controller
- SMMU: https://developer.arm.com/Architectures/System%20MMU%20Support
- ABI: https://developer.arm.com/Architectures/Application%20Binary%20Interface

Arm 架构文档

- 入门：之前有个 [ARM® Cortex®-A Series Programmer's Guide for ARMv8-A](https://developer.arm.com/documentation/den0024/a) 现在下载不到了，可以从 https://cs140e.sergio.bz/docs/ARMv8-A-Programmer-Guide.pdf 下载到，有人翻译了 https://www.zhihu.com/column/c_1455195069590962177
- 参考手册：[Arm Architecture Reference Manual for A-profile architecture](https://developer.arm.com/documentation/ddi0487/latest) 有 1 万多页。

GIC v3 v4 文档：

- 入门，偏概念介绍的文档：https://developer.arm.com/Architectures/Generic%20Interrupt%20Controller 列出的
  - https://developer.arm.com/documentation/dai0492/b/?lang=en
  - https://developer.arm.com/documentation/198123/0302/?lang=en
  - https://developer.arm.com/documentation/102923/0100/?lang=en
  - https://developer.arm.com/documentation/107627/0102/?lang=en
- 详尽的规范：[Arm Generic Interrupt Controller (GIC) Architecture Specification](https://developer.arm.com/documentation/ihi0069/hb/?lang=en)

SMMU 文档：

- 入门：[Learn the Architecture - SMMU Software Guide](https://developer.arm.com/documentation/109242/0100/?lang=en)
- 规范：[ARM System Memory Management Unit Architecture Specification - SMMU architecture version 2.0](https://developer.arm.com/documentation/ihi0062/dc/?lang=en)

## RISC-V 文档

- [RISC-V Technical Specifications](https://lf-riscv.atlassian.net/wiki/spaces/HOME/pages/16154769/RISC-V+Technical+Specifications)
  两个规范，特权指令集和非特权指令集，分别只有 172 页和 670 页。
- [RISC-V 开放架构设计之道](https://zh.z-lib.fm/book/27272743/ff0141)
