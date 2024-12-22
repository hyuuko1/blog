# 早期内存分配器 memblock

memblock 分配内存，会将这块内存标记为 reserved

两种分配方式，可以通过 `memblock_set_bottom_up()` 函数修改。

1. bottom-up
2. top-down
