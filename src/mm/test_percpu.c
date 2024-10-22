#include <linux/module.h>

MODULE_DESCRIPTION("Simple module");
MODULE_AUTHOR("Kernel Hacker");
MODULE_LICENSE("GPL");

#define ADDR_NUM ((1 << 20) / PCPU_MIN_UNIT_SIZE)

static int test_percpu_init(void)
{
	int cpu;
	int ret = 0;
	void __percpu *a;
	void __percpu *addr[ADDR_NUM];
	int i;

	pr_info("test_percpu_init\n");

	for_each_possible_cpu(cpu) {
		pr_info("cpu %d, offset = %lx, %lx\n", cpu, per_cpu_offset(cpu),
			per_cpu(this_cpu_off, cpu));
	}

	/* 每个 cpu 申请 1MB，每次最多 32KB */
	for (i = 0; i < ADDR_NUM; i++) {
		a = __alloc_percpu(PCPU_MIN_UNIT_SIZE, PAGE_SIZE);
		if (!a) {
			pr_err("Failed to __alloc_percpu()\n");
			i--;
			goto free;
		}

		pr_info("        i addr = %lx\n", (unsigned long)a);
		pr_info("i in cpu0 addr = %lx\n",
			(unsigned long)per_cpu_ptr(a, 0));
		pr_info("i in cpu1 addr = %lx\n",
			(unsigned long)per_cpu_ptr(a, 1));
		pr_info("  cpu 0 offset = %lx\n", per_cpu_ptr(a, 0) - a);
		pr_info("  cpu 1 offset = %lx\n\n", per_cpu_ptr(a, 1) - a);

		addr[i] = a;
	}

free:
	for (; i >= 0; i--)
		free_percpu(addr[i]);

	return ret;
}

static void test_percpu_exit(void)
{
	pr_info("test_percpu_exit\n");
}

module_init(test_percpu_init);
module_exit(test_percpu_exit);
