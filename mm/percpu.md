# per-cpu 变量的静态和动态分配

## 参考

- 🌟[Linux 内核同步机制之（二）：Per-CPU 变量](http://www.wowotech.net/kernel_synchronization/per-cpu.html)
- [每个 CPU 的变量 | linux-insides-zh](https://docs.hust.openatom.club/linux-insides-zh/concepts/linux-cpu-1)
- [LINUX PER-CPU 变量 | SVEN](https://lishiwen4.github.io/linux-kernel/per-cpu-var)
- [内核基础设施——per cpu 变量 - Notes about linux and my work](https://linux.laoqinren.net/kernel/percpu-var/)

## 概览

使用当前 cpu 变量时，应 `preempt_disable();` 禁止抢占，放置在 task 上下文时发生抢占，导致当前 task 在使用 cpu 变量时，被抢占后，被切换到其他 cpu 上运行。

静态 per-cpu 变量原理：

1. `__per_cpu_offset[NR_CPUS]` 数组，保存了偏移量（x86 架构会使用 `this_cpu_off` 这个 per-cpu 的变量，含义和前者一样，但更为高效）。
2. 对于 per-cpu 变量，这里将原始 per-cpu 变量称为 var，将在 cpu N 的副本变量称为 varN。
3. 静态 per-cpu 原始变量 var 存放在 `.data..percpu` section 里。
4. varN 的地址是 `&var + __per_cpu_offset[N]`。

### 定义静态 per-cpu 变量

### 动态分配 per-cpu 变量

```cpp
#define alloc_percpu(type)						\
	(typeof(type) __percpu *)__alloc_percpu(sizeof(type),		\
						__alignof__(type))

extern void free_percpu(void __percpu *__pdata);
```

### 访问 per-cpu 变量

形如 `*_ptr()` 的 API 表明传入的是指针。

```cpp
#define per_cpu_offset(x) (__per_cpu_offset[x])

#define per_cpu_ptr(ptr, cpu)						\
({									\
	__verify_pcpu_ptr(ptr);						\
	SHIFT_PERCPU_PTR((ptr), per_cpu_offset((cpu)));			\
})

/* 获取指定 cpu 上的 per-cpu 变量 */
#define per_cpu(var, cpu)	(*per_cpu_ptr(&(var), cpu))

/* arch/x86/include/asm/percpu.h */
#define arch_raw_cpu_ptr(_ptr)						\
({									\
	unsigned long tcp_ptr__ = raw_cpu_read_long(this_cpu_off);	\
									\
	tcp_ptr__ += (__force unsigned long)(_ptr);			\
	(typeof(*(_ptr)) __kernel __force *)tcp_ptr__;			\
})

#define raw_cpu_ptr(ptr)						\
({									\
	__verify_pcpu_ptr(ptr);						\
	arch_raw_cpu_ptr(ptr);						\
})
#define this_cpu_ptr(ptr) raw_cpu_ptr(ptr)

/* 传入一个 lvalue，该 lvalue 的地址 + per-cpu 的 this_cpu_off 就是我们想要取得的变量的地址 */
#define get_cpu_var(var)						\
(*({									\
	preempt_disable();						\
	this_cpu_ptr(&var);						\
}))

#define put_cpu_var(var)						\
do {									\
	(void)&(var);							\
	preempt_enable();						\
} while (0)

/* 传入一个指针，这个指针本身的值作为一个偏移量使用，加上 per-cpu 的 this_cpu_off 就是我们想要取得的变量的地址  */
#define get_cpu_ptr(var)						\
({									\
	preempt_disable();						\
	this_cpu_ptr(var);						\
})

#define put_cpu_ptr(var)						\
do {									\
	(void)(var);							\
	preempt_enable();						\
} while (0)
```

由于动态分配得到的是指针，所以只能用 `per_cpu_ptr()`, `get_cpu_ptr()` 和 `get_cpu_ptr()` 等等。

### 例子

```cpp
DEFINE_PER_CPU(unsigned long, process_counts) = 0;

int nr_processes(void)
{
	int cpu;
	int total = 0;

	for_each_possible_cpu(cpu)
		total += per_cpu(process_counts, cpu);

	return total;
}
```

代码在 [test_percpu.c](../src/mm/test_percpu.c)

发现 cpu0 和 cpu1 的 offset 的差值是 512KB。在 512KB 内，都是属于相同 cpu 的变量。
这并不意味着，某个 cpu 的 per-cpu 变量最多加起来就 512KB，因为是可以有很多组 `512KB * nr_cpu` 的。

PCPU_MIN_UNIT_SIZE 代表动态分配的 per-cpu 变量的最大 size 为 32KB。

## 静态分配

先分析最简单的。

## 动态分配

### [\[PATCHSET x86/core/percpu\] implement dynamic percpu allocator - Tejun Heo](https://lore.kernel.org/lkml/1234958676-27618-1-git-send-email-tj@kernel.org/)

### [\[PATCHSET percpu#for-next\] implement and use sparse embedding first chunk allocator - Tejun Heo](https://lore.kernel.org/all/1248171979-29166-1-git-send-email-tj@kernel.org/)
