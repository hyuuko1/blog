# stress-ng 用法

这里记录一下我经常用的命令

## 内存

- `-m N` `--vm N` 启动多少 workers
- `--vm-bytes N` 每个 worker 占用内存大小，默认 256MB
- `--vm-keep` 不会不断释放并重新分配，而是一直占用内存并持续写入
- `--vm-hang N` 每个 worker 分配内存后，睡眠 N 秒，N 为 0 时会一直睡眠。
- `--abort` 如果失败会退出。但是，注意 stress-ng 对 out of memory 有特殊处理，会一直重试？

```bash
stress-ng -m 1 --vm-bytes 1G --vm-hang 0 &
```

## 推荐

- [Linux 性能优化（一）——stress 压力测试工具\_linux stress-CSDN 博客](https://blog.csdn.net/A642960662/article/details/123030151)
