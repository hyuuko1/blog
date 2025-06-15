# KPTI

```cpp
/* 如果没禁用 pti，或着检查到 cpu 有熔断漏洞，则会加上 X86_FEATURE_PTI */
pti_check_boottime_disable()
  /* nopti 选项或着 mitigations=off 选项 */
  if (pti_mode == PTI_FORCE_OFF)
    pti_print_if_insecure("disabled on command line.");
    return;
  /* cpu 没有熔断漏洞，这个是在 cpu_set_bug_bits() 里设置的 */
  if (pti_mode == PTI_AUTO && !boot_cpu_has_bug(X86_BUG_CPU_MELTDOWN))
    return;
  setup_force_cpu_cap(X86_FEATURE_PTI);

probe_page_size_mask()
  if (cpu_feature_enabled(X86_FEATURE_PTI))
    __default_kernel_pte_mask &= ~_PAGE_GLOBAL;

pti_init()
  if (!boot_cpu_has(X86_FEATURE_PTI))
    return;


static int __init pti_parse_cmdline_nopti(char *arg)
{
	pti_mode = PTI_FORCE_OFF;
	return 0;
}
early_param("nopti", pti_parse_cmdline_nopti);
```

`PAGE_TABLE_ISOLATION`
