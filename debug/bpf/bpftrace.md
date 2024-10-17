# bpftrace

## 参考

- [盘点内核中常见的 CPU 性能卡点](https://mp.weixin.qq.com/s/moZjYijy2WcnGSTfv-nr9Q)
- [使用 bpftrace 分析内核-阿里云开发者社区](https://developer.aliyun.com/article/741492)

## 案例

```bash
sudo bpftrace -l | fzf
sudo bpftrace -e 'kfunc:vmlinux:__alloc_pages_noprof  { @[kstack] = count(); }'
```
