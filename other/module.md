# 内核模块

## 内核模块是如何调用内核中被 EXPORT_SYMBOL 的函数 ？

```cpp
load_module()
  simplify_symbols(mod, info);
    resolve_symbol_wait->resolve_symbol->find_symbol
      // 从 __start___ksymtab 和 __start___ksymtab_gpl 数组中查找符号，得到地址
      find_exported_symbol_in_section()
  apply_relocations(mod, info);
  post_relocation(mod, info);
```

因此，如果只是对内核进行了一些小小的改动，比如改了几个函数的实现，
没改动一些结构体的定义，就不会对已经编译的模块造成影响，
即使内核重新编译后会导致一些符号的地址变化，但之前编译的模块仍然可以继续使用的！

##

- [Linux 内核模块校验机制 | 夜云泊](https://lifeislife.cn/posts/linux%E5%86%85%E6%A0%B8%E6%A8%A1%E5%9D%97%E6%A0%A1%E9%AA%8C%E6%9C%BA%E5%88%B6/)
- [Linux 内核模块符号 CRC 检查机制-CSDN 博客](https://blog.csdn.net/linyt/article/details/42559639)
  内核模块 CRC 计算过程。
  函数签名或结构体定义发生变化，都会导致符号的 CRC 值发生变化。
- [【3-1】kABI - OpenAnolis 龙蜥操作系统开源社区](https://openanolis.cn/sig/Cloud-Kernel/doc/772144270149378762)
- [skozina/kabi-dw: A Kernel ABI checking tool](https://github.com/skozina/kabi-dw)
  KABI 检查。
  很多时候对结构体的些微改动，比如将 padding 位替换为有意义的成员，虽然会导致符号的 CRC 值发生变化，但是实际上并不会真正造成影响，模块实际上不编译也行。
  这个工具比 CONFIG_MODVERSIONS 更精确，避免了不必要的重新编译。

在开启 `CONFIG_MODVERSIONS` 后，模块中会新增 `_versions` 小节，
并且在编译出的 Module.symvers 有以下内容，第一列是符号的 CRC 值

```c
0xf7370f56	system_state	vmlinux	EXPORT_SYMBOL
0xbea5ff1e	static_key_initialized	vmlinux	EXPORT_SYMBOL_GPL
0xc2e587d1	reset_devices	vmlinux	EXPORT_SYMBOL
...
0xe44eb666	tsm_register	drivers/virt/coco/tsm	EXPORT_SYMBOL_GPL
0x89f5beb0	tsm_unregister	drivers/virt/coco/tsm	EXPORT_SYMBOL_GPL
```

Linux 对可装载模块采取了两层验证：除了上述的模块 CRC 值校验外还有 vermagic 的检查。模块 vermagic（即 Version Magic String）保存了模块编译时的内核版本以及 SMP 等配置信息，当模块 vermagic 与主机信息不相符时也无法加载模块。

```cpp
load_module()
  /* 先检查 module_layout 符号的 CRC 值和 vermagic */
  early_mod_check(info, flags);
    check_modstruct_version()
      check_version("module_layout") /* CRC */
    check_modinfo() /* vermagic */
  /* 解析模块用到的符号的地址，并校验这些符号的 CRC 值 */
  simplify_symbols(mod, info);
    resolve_symbol_wait()->resolve_symbol()
      check_version()
```

如何绕过 CRC 值校验？

1. 改代码
   ```cpp
   static int load_module(struct load_info *info, const char __user *uargs,
   		       int flags)
   {
   	/* 新增这一行 */
   	flags |= MODULE_INIT_IGNORE_MODVERSIONS | MODULE_INIT_IGNORE_VERMAGIC;
   	...
   }
   ```
2. 关闭 `CONFIG_MODVERSIONS`
3. 编译模块时，用对应内核的 Module.symvers，就不会校验失败了
4. [Linux 内核模块校验机制 | 夜云泊](https://lifeislife.cn/posts/linux%E5%86%85%E6%A0%B8%E6%A8%A1%E5%9D%97%E6%A0%A1%E9%AA%8C%E6%9C%BA%E5%88%B6/)

## 模块签名

如何绕过？

直接改代码，

```cpp
int module_sig_check(struct load_info *info, int flags)
{
	...
	err = mod_verify_sig(mod, info);
	err = 0; /* 新增这一样 */
	...
}
```

0x638fa329 module_layout vmlinux EXPORT_SYMBOL

如果在 zone_type 里新增，会影响到 MAX_NR_ZONES 的值，进而影响到一堆结构体。

```cpp
struct mm_struct {
	struct mem_cgroup *memcg; {
		struct mem_cgroup_per_node *nodeinfo[]; {
			// MAX_NR_ZONES 被修改了，所以会一直往上影响到 mm_struct
			unsigned long		lru_zone_size[MAX_NR_ZONES][NR_LRU_LISTS];
		}
	}
}
```
