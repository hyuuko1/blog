- [Linux Kernel Selftests — The Linux Kernel documentation](https://docs.kernel.org/dev-tools/kselftest.html)

```bash
# TARGETS 里的是位于 tools/testing/selftests 的目录，可以多个，用空格隔开
# 编译产物在 out/x86_64/kselftest
make O=out/x86_64 TARGETS="mm memfd" kselftest-all
# 编译并运行
make O=out/x86_64 TARGETS="mm memfd" kselftest
```
