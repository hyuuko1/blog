ccflags-y = -Wno-unused-function -Wno-unused-label -Wno-unused-variable -DDEBUG

obj-m	:= test_vmap.o

KDIR	:= /data/os-code/linux/out/x86_64
PWD	:= $(shell pwd)

all:
	make -C $(KDIR) M=$(PWD) LLVM=1 -j10

clean:
	make -C $(KDIR) M=$(PWD) LLVM=1 clean

.PHONY: all clean
