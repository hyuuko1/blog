#include "linux/gfp.h"
#include "linux/mm.h"
#include "linux/printk.h"
#include <linux/module.h>
#include <linux/vmalloc.h>

MODULE_DESCRIPTION("Simple module");
MODULE_AUTHOR("Kernel Hacker");
MODULE_LICENSE("GPL");

#define NR_PAGE 10

static int test_vmap_init(void)
{
	struct page *pages[NR_PAGE];
	void *vmap_addr, *addr;
	int i, nr_page, ret = 0;

	pr_debug("test_vmap_init\n");

	nr_page = alloc_pages_bulk_array(GFP_KERNEL, NR_PAGE, pages);
	if (!nr_page) {
		pr_err("Failed to alloc_pages_bulk_array\n");
		ret = -ENOMEM;
		goto exit;
	}
	pr_info("nr_page = %d\n", nr_page);

	addr = page_to_virt(pages[0]);
	vmap_addr = vmap(pages, NR_PAGE, VM_MAP, PAGE_KERNEL);
	if (!vmap_addr) {
		pr_err("Failed to vmap\n");
		goto free;
	}

	*((u8 *)addr) = 0x12;
	pr_info("first byte is 0x%x\n", *((u8 *)vmap_addr));

	vunmap(vmap_addr);

free:
	for (i = 0; i < nr_page; i++)
		__free_pages(pages[i], 0);

exit:
	return ret;
}

static void test_vmap_exit(void)
{
	pr_debug("test_vmap_exit\n");
}

module_init(test_vmap_init);
module_exit(test_vmap_exit);
