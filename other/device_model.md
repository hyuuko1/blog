# Linux 设备模型

- [Linux Device Model — The Linux Kernel documentation](https://linux-kernel-labs.github.io/refs/heads/master/labs/device_model.html)
- [Linux Device Model — Linux Kernel Labs](https://linux-kernel-labs.github.io/refs/heads/master/labs/device_model.html)
- [统一设备模型 - 蜗窝科技](https://www.wowotech.net/sort/device_model)
- [【Linux 内核|驱动模型】bus/class/device/driver - 知乎](https://zhuanlan.zhihu.com/p/644913485)

## device

## driver

## class

## bus

## subsystem

```cpp
subsys_system_register()
  subsys_register(subsys, groups, &system_kset->kobj)
    bus_register(subsys)
    struct device *dev = kzalloc(sizeof(struct device), GFP_KERNEL);

```
