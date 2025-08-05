# mlock

注意：锁住内存是指不让内存被 swap out，并不是 pin，并不能让内存不被移动。
那如果想要 pin 内存，该如何实现呢？DPDK 这种为了保证设备能 DMA 访问的内存不被内存，就需要 pin 内存，应该是通过 ioctl VFIO_IOMMU_MAP_DMA ?
