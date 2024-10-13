# Tips & Tricks

1. qemu 启动 linux 后，某些输出信息长度超过了终端宽度，被截断。

   原因：BIOS 输出了一些转义字符，导致终端的行为发生了一些变化。
   解决办法：启动后，先执行命令 `printf \\x1bc`

2. 使用 `printf \\x1bc` 替代 `clear` 命令，前者更管用
